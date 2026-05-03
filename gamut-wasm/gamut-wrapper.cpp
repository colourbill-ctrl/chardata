/**
 * compwas WASM module — polynomial model fitting + gamut mesh generation
 * for characterisation data (CSV-sourced CMYK/RGB/N-colorant + Lab).
 *
 * Exported embind functions:
 *   fitModel(inputJson)                         → model JSON
 *   buildGamutMesh(modelJson, steps)            → {vertices, triangles} JSON
 *   buildSlice(modelJson, axis, value, steps)   → {polygon, raw} JSON
 *
 * fitModel input JSON:
 *   { nColorants, colorantNames[], colorants[][], labL[], labA[], labB[] }
 *   colorants[][] are in original (unnormalised) units (e.g. 0..100 for ink %).
 *
 * buildGamutMesh: sweeps the 2-skeleton of the N-colorant device hypercube,
 *   evaluates the polynomial model at each grid point, and emits a regular-
 *   grid triangulation (same as iccgamut approach 4 / boundary cloud).
 *   steps: grid points per free axis (default from JS: BOUNDARY_STEPS[nC]).
 *
 * buildSlice: extracts the convex hull of isoline crossings at a fixed
 *   L/a/b value across the same 2-skeleton face grids.
 *   axis: 0=L, 1=a, 2=b.  Output (u,v) axes: L->(a,b), a->(L,b), b->(L,a).
 *
 * No external dependencies beyond nlohmann/json and Emscripten.
 */

#include <nlohmann/json.hpp>
#include <emscripten/bind.h>
#include <lcms2.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <functional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

using json = nlohmann::json;

// ── Polynomial features ───────────────────────────────────────────────────────
// Generates all monomials of degree 1..degree from a normalised input vector xs,
// prepended by the degree-0 bias term (1.0). Total count = C(n+d, d).
static std::vector<double> polyFeatures(const std::vector<double>& xs, int degree) {
    std::vector<double> f = {1.0};
    std::function<void(int, int, double)> gen = [&](int minIdx, int d, double product) {
        f.push_back(product);
        if (d == degree) return;
        for (int i = minIdx; i < (int)xs.size(); i++)
            gen(i, d + 1, product * xs[i]);
    };
    for (int i = 0; i < (int)xs.size(); i++)
        gen(i, 1, xs[i]);
    return f;
}

// ── OLS via normal equations (Gauss-Jordan, partial pivoting) ─────────────────
// Solves (XᵀX)β = Xᵀy. X is a vector of feature vectors; y is the target.
static std::vector<double> solveNE(const std::vector<std::vector<double>>& X,
                                    const std::vector<double>& y) {
    int n = (int)X.size();
    if (n == 0) throw std::runtime_error("solveNE: empty dataset");
    int m = (int)X[0].size();

    std::vector<std::vector<double>> A(m, std::vector<double>(m + 1, 0.0));
    for (int i = 0; i < n; i++) {
        for (int j = 0; j < m; j++) {
            for (int k = 0; k < m; k++) A[j][k] += X[i][j] * X[i][k];
            A[j][m] += X[i][j] * y[i];
        }
    }
    for (int col = 0; col < m; col++) {
        int pivot = col;
        for (int row = col + 1; row < m; row++)
            if (std::abs(A[row][col]) > std::abs(A[pivot][col])) pivot = row;
        std::swap(A[col], A[pivot]);
        double d = A[col][col];
        if (std::abs(d) < 1e-12) continue;
        for (int k = col; k <= m; k++) A[col][k] /= d;
        for (int row = 0; row < m; row++) {
            if (row == col) continue;
            double fac = A[row][col];
            for (int k = col; k <= m; k++) A[row][k] -= fac * A[col][k];
        }
    }
    std::vector<double> beta(m);
    for (int i = 0; i < m; i++) beta[i] = A[i][m];
    return beta;
}

// ── Weighted OLS ──────────────────────────────────────────────────────────────
// Solves (XᵀWX)β = XᵀWy where w is a per-row weight vector.
static std::vector<double> solveNEWeighted(const std::vector<std::vector<double>>& X,
                                            const std::vector<double>& y,
                                            const std::vector<double>& w) {
    int n = (int)X.size(), m = (int)X[0].size();
    std::vector<std::vector<double>> A(m, std::vector<double>(m + 1, 0.0));
    for (int i = 0; i < n; i++) {
        double wi = w[i];
        for (int j = 0; j < m; j++) {
            for (int k = 0; k < m; k++) A[j][k] += wi * X[i][j] * X[i][k];
            A[j][m] += wi * X[i][j] * y[i];
        }
    }
    for (int col = 0; col < m; col++) {
        int pivot = col;
        for (int row = col + 1; row < m; row++)
            if (std::abs(A[row][col]) > std::abs(A[pivot][col])) pivot = row;
        std::swap(A[col], A[pivot]);
        double d = A[col][col];
        if (std::abs(d) < 1e-12) continue;
        for (int k = col; k <= m; k++) A[col][k] /= d;
        for (int row = 0; row < m; row++) {
            if (row == col) continue;
            double fac = A[row][col];
            for (int k = col; k <= m; k++) A[row][k] -= fac * A[col][k];
        }
    }
    std::vector<double> beta(m);
    for (int i = 0; i < m; i++) beta[i] = A[i][m];
    return beta;
}

// ── ΔEab ─────────────────────────────────────────────────────────────────────
static double deltaEab(double L1, double a1, double b1,
                        double L2, double a2, double b2) {
    double dL = L1 - L2, da = a1 - a2, db = b1 - b2;
    return std::sqrt(dL*dL + da*da + db*db);
}

// ── Polynomial model evaluation ───────────────────────────────────────────────
struct ModelData {
    int nColorants, degree, nPts;
    std::vector<double> mins, ranges, coeffsL, coeffsA, coeffsB;
};

static void evalModel(const ModelData& m, const std::vector<double>& cv,
                       double& L, double& a, double& b) {
    std::vector<double> xs(m.nColorants);
    for (int i = 0; i < m.nColorants; i++)
        xs[i] = (cv[i] - m.mins[i]) / m.ranges[i];
    auto f = polyFeatures(xs, m.degree);
    auto dot = [&](const std::vector<double>& c) {
        double s = 0;
        for (int i = 0; i < (int)c.size(); i++) s += c[i] * f[i];
        return s;
    };
    L = dot(m.coeffsL);
    a = dot(m.coeffsA);
    b = dot(m.coeffsB);
}

static ModelData modelFromJson(const json& j) {
    ModelData m;
    m.nColorants = j["nColorants"].get<int>();
    m.degree     = j["degree"].get<int>();
    m.nPts       = j["nPts"].get<int>();
    for (auto& v : j["mins"])    m.mins.push_back(v.get<double>());
    for (auto& v : j["ranges"])  m.ranges.push_back(v.get<double>());
    for (auto& v : j["coeffsL"]) m.coeffsL.push_back(v.get<double>());
    for (auto& v : j["coeffsA"]) m.coeffsA.push_back(v.get<double>());
    for (auto& v : j["coeffsB"]) m.coeffsB.push_back(v.get<double>());
    return m;
}

// ── fitModel ──────────────────────────────────────────────────────────────────
// Fits a weighted polynomial model (degree 2..min(nC,5)) by iterating degrees
// and stopping when ΔEab fit stops improving. Uses anchor weights to anchor
// white point, primaries, and 50/50 secondaries.
static std::string fitModel(const std::string& inputJsonStr) {
    json inp = json::parse(inputJsonStr);

    int nC   = inp["nColorants"].get<int>();
    int nPts = (int)inp["labL"].size();

    if (nPts < 4)
        throw std::runtime_error("fitModel: need at least 4 data points");
    if (nC < 1 || nC > 15)
        throw std::runtime_error("fitModel: nColorants must be 1..15");

    // Parse colorant data
    std::vector<std::vector<double>> colorants(nPts, std::vector<double>(nC));
    for (int i = 0; i < nPts; i++)
        for (int j = 0; j < nC; j++)
            colorants[i][j] = inp["colorants"][i][j].get<double>();

    std::vector<double> labL(nPts), labA(nPts), labB(nPts);
    for (int i = 0; i < nPts; i++) {
        labL[i] = inp["labL"][i].get<double>();
        labA[i] = inp["labA"][i].get<double>();
        labB[i] = inp["labB"][i].get<double>();
    }

    // Per-channel min/range for normalisation
    std::vector<double> mins(nC, 1e9), maxs(nC, -1e9);
    for (int i = 0; i < nPts; i++)
        for (int j = 0; j < nC; j++) {
            mins[j] = std::min(mins[j], colorants[i][j]);
            maxs[j] = std::max(maxs[j], colorants[i][j]);
        }
    std::vector<double> ranges(nC);
    for (int j = 0; j < nC; j++) {
        ranges[j] = maxs[j] - mins[j];
        if (ranges[j] < 1e-9) ranges[j] = 1.0;
    }

    // Normalise colorants to [0, 1]
    std::vector<std::vector<double>> norm(nPts, std::vector<double>(nC));
    for (int i = 0; i < nPts; i++)
        for (int j = 0; j < nC; j++)
            norm[i][j] = (colorants[i][j] - mins[j]) / ranges[j];

    // Anchor weights: white point, primaries, 50/50 secondaries (excl. black)
    const double ANCHOR_WEIGHT = 50.0;
    std::vector<double> weights(nPts, 1.0);
    for (int i = 0; i < nPts; i++) {
        std::vector<int> nzIdx;
        for (int j = 0; j < nC; j++)
            if (colorants[i][j] > 1e-6) nzIdx.push_back(j);
        if (nzIdx.empty()) {
            weights[i] = ANCHOR_WEIGHT; // white point
        } else if ((int)nzIdx.size() == 1) {
            weights[i] = ANCHOR_WEIGHT; // primary
        } else if ((int)nzIdx.size() == 2 && nC >= 3) {
            // 50/50 secondary (neither is the K channel = last)
            bool hasBlack = (nzIdx[0] == nC - 1 || nzIdx[1] == nC - 1);
            if (!hasBlack) {
                double v0 = colorants[i][nzIdx[0]], v1 = colorants[i][nzIdx[1]];
                double avg = (v0 + v1) / 2.0;
                if (avg > 1e-6 && std::abs(v0 - v1) < 0.05 * avg)
                    weights[i] = ANCHOR_WEIGHT;
            }
        }
    }

    // Degree search: 2 .. min(nC, 5)
    const int MAX_DEGREE = 5;
    int bestDeg = 2;
    double bestMean = 1e9;
    std::vector<double> bestCoeffsL, bestCoeffsA, bestCoeffsB;

    for (int deg = 2; deg <= std::min(nC, MAX_DEGREE); deg++) {
        std::vector<std::vector<double>> X(nPts);
        for (int i = 0; i < nPts; i++)
            X[i] = polyFeatures(norm[i], deg);

        auto cL = solveNEWeighted(X, labL, weights);
        auto cA = solveNEWeighted(X, labA, weights);
        auto cB = solveNEWeighted(X, labB, weights);

        double sumDE = 0;
        for (int i = 0; i < nPts; i++) {
            const auto& f = X[i];
            auto dot = [&](const std::vector<double>& c) {
                double s = 0;
                for (int k = 0; k < (int)c.size(); k++) s += c[k] * f[k];
                return s;
            };
            sumDE += deltaEab(dot(cL), dot(cA), dot(cB), labL[i], labA[i], labB[i]);
        }
        double mean = sumDE / nPts;

        if (mean < bestMean) {
            bestMean    = mean;
            bestDeg     = deg;
            bestCoeffsL = cL;
            bestCoeffsA = cA;
            bestCoeffsB = cB;
        } else {
            break; // worse — stop searching
        }
    }

    // Full stats at best degree
    std::vector<std::vector<double>> X(nPts);
    for (int i = 0; i < nPts; i++)
        X[i] = polyFeatures(norm[i], bestDeg);

    double sumDE = 0, sumDE2 = 0, maxDE = 0, minDE = 1e9;
    for (int i = 0; i < nPts; i++) {
        const auto& f = X[i];
        auto dot = [&](const std::vector<double>& c) {
            double s = 0;
            for (int k = 0; k < (int)c.size(); k++) s += c[k] * f[k];
            return s;
        };
        double de = deltaEab(dot(bestCoeffsL), dot(bestCoeffsA), dot(bestCoeffsB),
                             labL[i], labA[i], labB[i]);
        sumDE += de; sumDE2 += de * de;
        maxDE = std::max(maxDE, de);
        minDE = std::min(minDE, de);
    }
    double mean  = sumDE / nPts;
    double stdev = std::sqrt(std::max(0.0, sumDE2 / nPts - mean * mean));

    json model;
    model["nColorants"]    = nC;
    model["colorantNames"] = inp["colorantNames"];
    model["mins"]          = mins;
    model["ranges"]        = ranges;
    model["degree"]        = bestDeg;
    model["nPts"]          = nPts;
    model["coeffsL"]       = bestCoeffsL;
    model["coeffsA"]       = bestCoeffsA;
    model["coeffsB"]       = bestCoeffsB;
    model["stats"]         = {{"mean", mean}, {"stdev", stdev},
                               {"max", maxDE}, {"min", minDE}};
    return model.dump();
}

// ── buildGamutMesh ────────────────────────────────────────────────────────────
// Sweeps the 2-skeleton of the N-colorant device hypercube (all pairs of free
// dims x all fixings of remaining dims at 0/1), evaluates the polynomial model
// at each grid point, and emits a regular-grid triangulation.
//
// Total 2-faces: C(N,2) * 2^(N-2).  Per-face grid: (steps+1)^2 vertices,
// steps^2 quads -> 2*steps^2 triangles.  For N=4 (CMYK): 24 faces.

static std::string buildGamutMesh(const std::string& modelJsonStr, int steps) {
    if (steps < 2 || steps > 200)
        throw std::runtime_error("buildGamutMesh: steps must be 2..200");

    ModelData m = modelFromJson(json::parse(modelJsonStr));
    int N = m.nColorants;
    int S = steps;

    json vertices  = json::array();
    json triangles = json::array();
    std::vector<double> cv(N);

    for (int di = 0; di < N; di++) {
        for (int dj = di + 1; dj < N; dj++) {
            std::vector<int> fixedDims;
            for (int d = 0; d < N; d++)
                if (d != di && d != dj) fixedDims.push_back(d);
            int nFixed  = (int)fixedDims.size();
            int nCombos = 1 << nFixed;

            for (int combo = 0; combo < nCombos; combo++) {
                for (int k = 0; k < nFixed; k++)
                    cv[fixedDims[k]] = ((combo >> k) & 1) ? 1.0 : 0.0;

                int baseV = (int)vertices.size();
                for (int u = 0; u <= S; u++) {
                    cv[di] = (double)u / S;
                    for (int w = 0; w <= S; w++) {
                        cv[dj] = (double)w / S;
                        std::vector<double> colorantVals(N);
                        for (int d = 0; d < N; d++)
                            colorantVals[d] = cv[d] * m.ranges[d] + m.mins[d];
                        double L, a, b;
                        evalModel(m, colorantVals, L, a, b);
                        vertices.push_back(json::array({L, a, b}));
                    }
                }

                for (int u = 0; u < S; u++) {
                    for (int w = 0; w < S; w++) {
                        int v00 = baseV +  u      * (S + 1) + w;
                        int v01 = baseV +  u      * (S + 1) + (w + 1);
                        int v10 = baseV + (u + 1) * (S + 1) + w;
                        int v11 = baseV + (u + 1) * (S + 1) + (w + 1);
                        triangles.push_back(json::array({v00, v01, v11}));
                        triangles.push_back(json::array({v00, v11, v10}));
                    }
                }
            }
        }
    }

    json result;
    result["vertices"]  = std::move(vertices);
    result["triangles"] = std::move(triangles);
    return result.dump();
}

// ── 2D convex hull (Andrew's monotone chain) ──────────────────────────────────
static std::vector<std::array<double, 2>>
convexHull2D(std::vector<std::array<double, 2>> pts) {
    int n = (int)pts.size();
    if (n < 3) return pts;
    std::sort(pts.begin(), pts.end(), [](const auto& a, const auto& b) {
        return a[0] != b[0] ? a[0] < b[0] : a[1] < b[1];
    });
    auto cross = [](const std::array<double, 2>& O,
                    const std::array<double, 2>& A,
                    const std::array<double, 2>& B) {
        return (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
    };
    std::vector<std::array<double, 2>> lower, upper;
    lower.reserve(n); upper.reserve(n);
    for (const auto& p : pts) {
        while (lower.size() >= 2 && cross(lower[lower.size()-2], lower.back(), p) <= 0)
            lower.pop_back();
        lower.push_back(p);
    }
    for (int i = n - 1; i >= 0; i--) {
        const auto& p = pts[i];
        while (upper.size() >= 2 && cross(upper[upper.size()-2], upper.back(), p) <= 0)
            upper.pop_back();
        upper.push_back(p);
    }
    lower.pop_back();
    upper.pop_back();
    lower.insert(lower.end(), upper.begin(), upper.end());
    return lower; // CCW
}

// ── buildSlice ────────────────────────────────────────────────────────────────
// Sweeps the same 2-skeleton face grids as buildGamutMesh. For each grid edge
// whose endpoints straddle the target plane (axis == value), linearly
// interpolates the crossing and collects it. Then returns the convex hull.
//
// axis: 0=L*, 1=a*, 2=b*
// Output (u,v): L→(a*,b*), a→(L*,b*), b→(L*,a*)
static std::string buildSlice(const std::string& modelJsonStr,
                               int axis, double value, int steps) {
    if (axis < 0 || axis > 2)
        throw std::runtime_error("buildSlice: axis must be 0 (L*), 1 (a*), or 2 (b*)");
    if (steps < 2 || steps > 200)
        throw std::runtime_error("buildSlice: steps must be 2..200");

    ModelData m = modelFromJson(json::parse(modelJsonStr));
    int N = m.nColorants;
    int S = steps;

    // u, v Lab axis indices by slice axis
    int au = (axis == 0) ? 1 : 0;  // a* if slicing L, else L*
    int av = (axis == 2) ? 1 : 2;  // a* if slicing b, else b*

    std::vector<std::array<double, 2>> raw;
    std::vector<double> cv(N);

    // Reusable per-face Lab grid
    std::vector<std::array<double, 3>> grid(static_cast<std::size_t>(S + 1) * (S + 1));

    for (int di = 0; di < N; di++) {
        for (int dj = di + 1; dj < N; dj++) {
            std::vector<int> fixedDims;
            for (int d = 0; d < N; d++)
                if (d != di && d != dj) fixedDims.push_back(d);
            int nFixed  = (int)fixedDims.size();
            int nCombos = 1 << nFixed;

            for (int combo = 0; combo < nCombos; combo++) {
                for (int k = 0; k < nFixed; k++)
                    cv[fixedDims[k]] = ((combo >> k) & 1) ? 1.0 : 0.0;

                // Build (S+1)×(S+1) Lab grid for this face
                for (int u = 0; u <= S; u++) {
                    cv[di] = (double)u / S;
                    for (int w = 0; w <= S; w++) {
                        cv[dj] = (double)w / S;
                        std::vector<double> colorantVals(N);
                        for (int d = 0; d < N; d++)
                            colorantVals[d] = cv[d] * m.ranges[d] + m.mins[d];
                        double L, a, b;
                        evalModel(m, colorantVals, L, a, b);
                        grid[u * (S + 1) + w] = {L, a, b};
                    }
                }

                auto pushCrossing = [&](int idxA, int idxB) {
                    const auto& la = grid[idxA];
                    const auto& lb = grid[idxB];
                    double sa = la[axis], sb = lb[axis];
                    double dA = sa - value, dB = sb - value;
                    if ((dA > 0 && dB > 0) || (dA < 0 && dB < 0)) return;
                    if (sa == sb) {
                        // Both exactly on the plane — emit both
                        if (dA == 0) {
                            raw.push_back({la[au], la[av]});
                            raw.push_back({lb[au], lb[av]});
                        }
                        return;
                    }
                    double t = (value - sa) / (sb - sa);
                    raw.push_back({
                        la[au] + t * (lb[au] - la[au]),
                        la[av] + t * (lb[av] - la[av])
                    });
                };

                // Walk all grid edges in both free dimensions
                for (int u = 0; u < S; u++)
                    for (int w = 0; w <= S; w++)
                        pushCrossing(u * (S + 1) + w, (u + 1) * (S + 1) + w);
                for (int u = 0; u <= S; u++)
                    for (int w = 0; w < S; w++)
                        pushCrossing(u * (S + 1) + w, u * (S + 1) + (w + 1));
            }
        }
    }

    auto hull = convexHull2D(raw);

    json rawJson  = json::array();
    for (const auto& p : raw)  rawJson.push_back(json::array({p[0], p[1]}));
    json polyJson = json::array();
    for (const auto& p : hull) polyJson.push_back(json::array({p[0], p[1]}));

    const char* axisName = (axis == 0) ? "L" : (axis == 1) ? "a" : "b";

    json result;
    result["axis"]    = axisName;
    result["value"]   = value;
    result["raw"]     = std::move(rawJson);
    result["polygon"] = std::move(polyJson);
    return result.dump();
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── ICC profile evaluation via lcms2 ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// ── Base64 decoder ────────────────────────────────────────────────────────────
static std::vector<uint8_t> base64Decode(const std::string& enc) {
    static const char* tbl =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::vector<uint8_t> out;
    out.reserve(enc.size() * 3 / 4);
    int val = 0, valb = -8;
    for (unsigned char c : enc) {
        if (c == '=') break;
        const char* p = std::strchr(tbl, (char)c);
        if (!p) continue;
        val = (val << 6) + (int)(p - tbl);
        valb += 6;
        if (valb >= 0) {
            out.push_back((uint8_t)((val >> valb) & 0xFF));
            valb -= 8;
        }
    }
    return out;
}

// ── ICC profile state ─────────────────────────────────────────────────────────
struct IccProfile {
    cmsHPROFILE      hProfile    = nullptr;
    cmsHTRANSFORM    xforms[4]   = {nullptr, nullptr, nullptr, nullptr};
    cmsUInt32Number  inputFmt    = 0;
    int              nColorants  = 0;
    std::string      colorSpace;   // "CMYK", "RGB ", etc.
    std::string      deviceClass;  // "prtr", "mntr", "scnr"
    std::string      description;
    // lcms2 floating-point input convention is 0..100 for ink spaces (CMYK, CMY)
    // and 0..1 for non-ink (RGB, GRAY) — see UnrollDoubleTo16 in cmspack.c.
    // The UI/JS layer always sends 0..100, so this is the multiplier used to
    // map UI value into lcms's expected device-channel range.
    double           inputMax    = 1.0;
};

static std::unordered_map<int, IccProfile> gIccProfiles;
static int gNextIccHandle = 1;

// ── Helpers ───────────────────────────────────────────────────────────────────
static std::string sig4str(cmsUInt32Number sig) {
    char buf[5] = {0};
    buf[0] = (char)((sig >> 24) & 0xFF);
    buf[1] = (char)((sig >> 16) & 0xFF);
    buf[2] = (char)((sig >>  8) & 0xFF);
    buf[3] = (char)((sig      ) & 0xFF);
    // trim trailing spaces
    for (int i = 3; i >= 0 && buf[i] == ' '; i--) buf[i] = 0;
    return std::string(buf);
}

// TYPE_CMY_DBL is not defined in lcms2 — build it from the macro primitives.
// FLOAT_SH(1)|COLORSPACE_SH(PT_CMY)|CHANNELS_SH(3)|BYTES_SH(0) == 3-channel 64-bit float.
#define TYPE_CMY_DBL (FLOAT_SH(1)|COLORSPACE_SH(PT_CMY)|CHANNELS_SH(3)|BYTES_SH(0))

// Generic NCLR pixel format (n=2..15). lcms2 doesn't define TYPE_MCHn_DBL macros;
// synthesise from PT_MCH1..PT_MCH15 (PT_MCH1 + (n-1) == PT_MCHn).
static cmsUInt32Number nclrFmt(int n) {
    if (n < 2 || n > 15) return 0;
    return FLOAT_SH(1) | COLORSPACE_SH(PT_MCH1 + (n - 1)) | CHANNELS_SH(n) | BYTES_SH(0);
}

static cmsUInt32Number csInputFmt(cmsColorSpaceSignature cs) {
    switch (cs) {
        case cmsSigCmykData: return TYPE_CMYK_DBL;
        case cmsSigRgbData:  return TYPE_RGB_DBL;
        case cmsSigGrayData: return TYPE_GRAY_DBL;
        case cmsSigCmyData:  return TYPE_CMY_DBL;
        // Generic NCLR (multi-colorant) profiles. Channel count comes from the
        // signature: cmsSig{N}colorData -> N channels.
        case cmsSig2colorData:  return nclrFmt(2);
        case cmsSig3colorData:  return nclrFmt(3);
        case cmsSig4colorData:  return nclrFmt(4);
        case cmsSig5colorData:  return nclrFmt(5);
        case cmsSig6colorData:  return nclrFmt(6);
        case cmsSig7colorData:  return nclrFmt(7);
        case cmsSig8colorData:  return nclrFmt(8);
        case cmsSig9colorData:  return nclrFmt(9);
        case cmsSig10colorData: return nclrFmt(10);
        case cmsSig11colorData: return nclrFmt(11);
        case cmsSig12colorData: return nclrFmt(12);
        case cmsSig13colorData: return nclrFmt(13);
        case cmsSig14colorData: return nclrFmt(14);
        case cmsSig15colorData: return nclrFmt(15);
        default:             return 0;
    }
}

// True if the device color space is treated as ink (0..100 range) by lcms2.
// Mirrors lcms2's IsInkSpace in cmspack.c plus our explicit CMY case.
static bool csIsInkSpace(cmsColorSpaceSignature cs) {
    switch (cs) {
        case cmsSigCmykData:
        case cmsSigCmyData:
        case cmsSig5colorData:
        case cmsSig6colorData:
        case cmsSig7colorData:
        case cmsSig8colorData:
        case cmsSig9colorData:
        case cmsSig10colorData:
        case cmsSig11colorData:
        case cmsSig12colorData:
        case cmsSig13colorData:
        case cmsSig14colorData:
        case cmsSig15colorData:
            return true;
        default:
            return false;
    }
}

// True if the color space is a generic NCLR signature (cmsSig{N}colorData).
static bool csIsNclr(cmsColorSpaceSignature cs) {
    switch (cs) {
        case cmsSig2colorData:  case cmsSig3colorData:  case cmsSig4colorData:
        case cmsSig5colorData:  case cmsSig6colorData:  case cmsSig7colorData:
        case cmsSig8colorData:  case cmsSig9colorData:  case cmsSig10colorData:
        case cmsSig11colorData: case cmsSig12colorData: case cmsSig13colorData:
        case cmsSig14colorData: case cmsSig15colorData:
            return true;
        default:
            return false;
    }
}

static std::vector<std::string> csColorantNames(cmsColorSpaceSignature cs) {
    switch (cs) {
        case cmsSigCmykData: return {"CYAN","MAGENTA","YELLOW","BLACK"};
        case cmsSigRgbData:  return {"RED","GREEN","BLUE"};
        case cmsSigGrayData: return {"GRAY"};
        case cmsSigCmyData:  return {"CYAN","MAGENTA","YELLOW"};
        default: {
            int n = (int)cmsChannelsOf(cs);
            std::vector<std::string> names;
            for (int i = 0; i < n; i++) names.push_back("CH" + std::to_string(i + 1));
            return names;
        }
    }
}

// Try to read the ICC colorantTableTag for actual ink names (e.g. "Cyan",
// "Orange", "Violet" on an extended-gamut printer profile). Returns an empty
// vector on any failure; caller should fall back to csColorantNames.
static std::vector<std::string> readColorantTable(cmsHPROFILE h, int expectedN) {
    std::vector<std::string> names;
    if (!cmsIsTag(h, cmsSigColorantTableTag)) return names;
    cmsNAMEDCOLORLIST* list = (cmsNAMEDCOLORLIST*)cmsReadTag(h, cmsSigColorantTableTag);
    if (!list) return names;
    int n = (int)cmsNamedColorCount(list);
    if (n != expectedN) return names;
    for (int i = 0; i < n; i++) {
        char nm[33] = {0};
        if (!cmsNamedColorInfo(list, i, nm, nullptr, nullptr, nullptr, nullptr)) {
            return {};
        }
        names.push_back(nm);
    }
    return names;
}

// Get or create a Lab4 transform for the given rendering intent (0–3).
static cmsHTRANSFORM iccGetTransform(IccProfile& p, int intent) {
    if (intent < 0 || intent > 3) intent = 1;
    if (p.xforms[intent]) return p.xforms[intent];
    cmsHPROFILE hLab = cmsCreateLab4Profile(nullptr);
    if (!hLab) return nullptr;
    p.xforms[intent] = cmsCreateTransform(
        p.hProfile, p.inputFmt,
        hLab,        TYPE_Lab_DBL,
        intent, cmsFLAGS_NOCACHE);
    cmsCloseProfile(hLab);
    return p.xforms[intent];
}

// ── loadIccProfile ────────────────────────────────────────────────────────────
// Accepts: base64-encoded ICC binary.
// Returns: JSON { handle, colorSpace, deviceClass, description, nColorants,
//                 colorants[], intents[] }
//          or   { error: "..." }
static std::string loadIccProfile(const std::string& base64Data) {
    auto bytes = base64Decode(base64Data);
    if (bytes.empty()) return "{\"error\":\"empty data\"}";
    // Reject oversized profiles — typical ICC files are <2 MB; cap at 32 MB to
    // protect the WASM heap from DoS via a maliciously huge profile.
    if (bytes.size() > 32u * 1024u * 1024u) return "{\"error\":\"profile too large (>32 MB)\"}";
    // ICC v2/v4 header is 128 bytes minimum; the magic check at offset 36 also
    // requires this. Reject obviously truncated input before lcms2 sees it.
    if (bytes.size() < 128) return "{\"error\":\"profile too small (<128 bytes)\"}";

    cmsHPROFILE h = cmsOpenProfileFromMem(bytes.data(), (cmsUInt32Number)bytes.size());
    if (!h) return "{\"error\":\"not a valid ICC profile\"}";

    cmsProfileClassSignature cls = cmsGetDeviceClass(h);
    if (cls != cmsSigOutputClass &&
        cls != cmsSigInputClass  &&
        cls != cmsSigDisplayClass) {
        cmsCloseProfile(h);
        return "{\"error\":\"only output/input/display profiles supported\"}";
    }

    cmsColorSpaceSignature cs = cmsGetColorSpace(h);
    cmsUInt32Number fmt = csInputFmt(cs);
    if (fmt == 0) {
        cmsCloseProfile(h);
        return "{\"error\":\"unsupported device color space\"}";
    }

    char descBuf[512] = {0};
    cmsGetProfileInfoASCII(h, cmsInfoDescription, "en", "US", descBuf, sizeof(descBuf));

    std::vector<int> avail;
    for (int i = 0; i < 4; i++)
        if (cmsIsIntentSupported(h, i, LCMS_USED_AS_INPUT)) avail.push_back(i);

    IccProfile prof;
    prof.hProfile    = h;
    prof.inputFmt    = fmt;
    prof.nColorants  = (int)cmsChannelsOf(cs);
    prof.colorSpace  = sig4str((cmsUInt32Number)cs);
    prof.deviceClass = sig4str((cmsUInt32Number)cls);
    prof.description = std::string(descBuf);
    // Ink spaces (CMYK, CMY, NCLR ≥5ch) take 0..100 per lcms2's IsInkSpace
    // convention; non-ink (RGB, GRAY, 2-4CLR generic) take 0..1.
    prof.inputMax    = csIsInkSpace(cs) ? 100.0 : 1.0;

    int handle = gNextIccHandle++;
    gIccProfiles[handle] = std::move(prof);

    auto& stored = gIccProfiles[handle];
    auto  names  = csColorantNames(cs);

    // For NCLR profiles, prefer the colorantTableTag (per ICC spec, expected to
    // be present on N-color output profiles) so we surface real ink names like
    // "Cyan", "Orange", "Violet" instead of generic CH1..CHn.
    if (csIsNclr(cs)) {
        auto tableNames = readColorantTable(h, stored.nColorants);
        if (!tableNames.empty()) names = std::move(tableNames);
    }

    json r;
    r["handle"]      = handle;
    r["colorSpace"]  = stored.colorSpace;
    r["deviceClass"] = stored.deviceClass;
    r["description"] = stored.description;
    r["nColorants"]  = stored.nColorants;
    r["colorants"]   = names;
    r["intents"]     = avail;
    return r.dump();
}

// ── evalIccA2B ────────────────────────────────────────────────────────────────
// colorantsJson: JSON array of values in 0–100 range.
// Returns: JSON { L, a, b }
static std::string evalIccA2B(int handle, const std::string& colorantsJson, int intent) {
    auto it = gIccProfiles.find(handle);
    if (it == gIccProfiles.end()) return "{\"error\":\"invalid handle\"}";
    auto& p = it->second;
    cmsHTRANSFORM xf = iccGetTransform(p, intent);
    if (!xf) return "{\"error\":\"transform failed\"}";

    json inp = json::parse(colorantsJson);
    int N = p.nColorants;
    const double s = p.inputMax / 100.0;   // UI 0..100 → lcms 0..inputMax
    std::vector<double> in(N, 0.0), out(3, 0.0);
    for (int i = 0; i < N && i < (int)inp.size(); i++)
        in[i] = inp[i].get<double>() * s;

    cmsDoTransform(xf, in.data(), out.data(), 1);

    json r;
    r["L"] = out[0]; r["a"] = out[1]; r["b"] = out[2];
    return r.dump();
}

// ── evalIccBatch ─────────────────────────────────────────────────────────────
// patchesJson: [[c,m,y,k], ...] values in 0–100 range.
// Returns: [{L,a,b}, ...] — one per patch in same order.
static std::string evalIccBatch(int handle, const std::string& patchesJson, int intent) {
    auto it = gIccProfiles.find(handle);
    if (it == gIccProfiles.end()) return "{\"error\":\"invalid handle\"}";
    auto& p = it->second;
    cmsHTRANSFORM xf = iccGetTransform(p, intent);
    if (!xf) return "{\"error\":\"transform failed\"}";

    json patches = json::parse(patchesJson);
    int N = p.nColorants;
    int nPts = (int)patches.size();
    const double s = p.inputMax / 100.0;

    std::vector<double> inBuf(nPts * N, 0.0);
    for (int i = 0; i < nPts; i++)
        for (int j = 0; j < N && j < (int)patches[i].size(); j++)
            inBuf[i * N + j] = patches[i][j].get<double>() * s;

    std::vector<double> outBuf(nPts * 3, 0.0);
    cmsDoTransform(xf, inBuf.data(), outBuf.data(), (cmsUInt32Number)nPts);

    json r = json::array();
    for (int i = 0; i < nPts; i++) {
        json pt;
        pt["L"] = outBuf[i * 3 + 0];
        pt["a"] = outBuf[i * 3 + 1];
        pt["b"] = outBuf[i * 3 + 2];
        r.push_back(std::move(pt));
    }
    return r.dump();
}

// ── buildIccGamutMesh ─────────────────────────────────────────────────────────
// Same 2-skeleton sweep as buildGamutMesh, but evaluated via ICC CLUT.
// Uses one batch cmsDoTransform call for the entire mesh.
// Returns: JSON { vertices: [[L,a,b],...], triangles: [[i,j,k],...] }
static std::string buildIccGamutMesh(int handle, int intent, int steps) {
    auto it = gIccProfiles.find(handle);
    if (it == gIccProfiles.end()) return "{\"error\":\"invalid handle\"}";
    auto& p = it->second;
    if (steps < 2 || steps > 200)
        return "{\"error\":\"steps must be 2..200\"}";

    cmsHTRANSFORM xf = iccGetTransform(p, intent);
    if (!xf) return "{\"error\":\"transform failed\"}";

    int N = p.nColorants;
    int S = steps;

    // Phase 1: collect all device-space sample points (flat buffer, N doubles each)
    // and record the base-vertex index for each face (for triangle building).
    std::vector<double>   inputBatch;
    std::vector<int>      faceBaseV;

    for (int di = 0; di < N; di++) {
        for (int dj = di + 1; dj < N; dj++) {
            std::vector<int> fixedDims;
            for (int d = 0; d < N; d++)
                if (d != di && d != dj) fixedDims.push_back(d);
            int nFixed  = (int)fixedDims.size();
            int nCombos = 1 << nFixed;

            for (int combo = 0; combo < nCombos; combo++) {
                faceBaseV.push_back((int)(inputBatch.size() / N));

                for (int u = 0; u <= S; u++) {
                    for (int w = 0; w <= S; w++) {
                        std::vector<double> cv(N, 0.0);
                        cv[di] = (double)u / S * p.inputMax;
                        cv[dj] = (double)w / S * p.inputMax;
                        for (int k = 0; k < nFixed; k++)
                            cv[fixedDims[k]] = ((combo >> k) & 1) ? p.inputMax : 0.0;
                        for (int d = 0; d < N; d++) inputBatch.push_back(cv[d]);
                    }
                }
            }
        }
    }

    int nPts = (int)(inputBatch.size() / N);

    // Phase 2: batch evaluate (device → Lab)
    std::vector<double> labBatch(nPts * 3);
    cmsDoTransform(xf, inputBatch.data(), labBatch.data(), (cmsUInt32Number)nPts);

    // Phase 3: build vertex and triangle lists
    json vertices = json::array();
    for (int i = 0; i < nPts; i++)
        vertices.push_back(json::array({labBatch[i*3], labBatch[i*3+1], labBatch[i*3+2]}));

    json triangles = json::array();
    int faceIdx = 0;
    for (int di = 0; di < N; di++) {
        for (int dj = di + 1; dj < N; dj++) {
            std::vector<int> fixedDims;
            for (int d = 0; d < N; d++)
                if (d != di && d != dj) fixedDims.push_back(d);
            int nCombos = 1 << (int)fixedDims.size();

            for (int combo = 0; combo < nCombos; combo++) {
                int baseV = faceBaseV[faceIdx++];
                for (int u = 0; u < S; u++) {
                    for (int w = 0; w < S; w++) {
                        int v00 = baseV +  u      * (S + 1) + w;
                        int v01 = baseV +  u      * (S + 1) + (w + 1);
                        int v10 = baseV + (u + 1) * (S + 1) + w;
                        int v11 = baseV + (u + 1) * (S + 1) + (w + 1);
                        triangles.push_back(json::array({v00, v01, v11}));
                        triangles.push_back(json::array({v00, v11, v10}));
                    }
                }
            }
        }
    }

    json result;
    result["vertices"]  = std::move(vertices);
    result["triangles"] = std::move(triangles);
    return result.dump();
}

// ── buildIccSlice ─────────────────────────────────────────────────────────────
// Same isoline-crossing approach as buildSlice, using ICC CLUT evaluation.
// Processes one 2-face at a time to keep memory bounded.
static std::string buildIccSlice(int handle, int intent, int axis, double value, int steps) {
    auto it = gIccProfiles.find(handle);
    if (it == gIccProfiles.end()) return "{\"error\":\"invalid handle\"}";
    auto& p = it->second;
    if (axis < 0 || axis > 2)  return "{\"error\":\"axis must be 0..2\"}";
    if (steps < 2 || steps > 200) return "{\"error\":\"steps must be 2..200\"}";

    cmsHTRANSFORM xf = iccGetTransform(p, intent);
    if (!xf) return "{\"error\":\"transform failed\"}";

    int N = p.nColorants;
    int S = steps;
    int gridSize = (S + 1) * (S + 1);

    int au = (axis == 0) ? 1 : 0;   // (L-slice→a*, else→L*)
    int av = (axis == 2) ? 1 : 2;   // (b-slice→a*, else→b*)

    std::vector<double> inputFace(gridSize * N);
    std::vector<double> labFace(gridSize * 3);
    std::vector<std::array<double, 2>> raw;

    for (int di = 0; di < N; di++) {
        for (int dj = di + 1; dj < N; dj++) {
            std::vector<int> fixedDims;
            for (int d = 0; d < N; d++)
                if (d != di && d != dj) fixedDims.push_back(d);
            int nFixed  = (int)fixedDims.size();
            int nCombos = 1 << nFixed;

            for (int combo = 0; combo < nCombos; combo++) {
                // Build face input grid
                for (int u = 0; u <= S; u++) {
                    for (int w = 0; w <= S; w++) {
                        int idx = u * (S + 1) + w;
                        std::vector<double> cv(N, 0.0);
                        cv[di] = (double)u / S * p.inputMax;
                        cv[dj] = (double)w / S * p.inputMax;
                        for (int k = 0; k < nFixed; k++)
                            cv[fixedDims[k]] = ((combo >> k) & 1) ? p.inputMax : 0.0;
                        for (int d = 0; d < N; d++) inputFace[idx * N + d] = cv[d];
                    }
                }

                cmsDoTransform(xf, inputFace.data(), labFace.data(), (cmsUInt32Number)gridSize);

                auto pushCrossing = [&](int idxA, int idxB) {
                    double sa = labFace[idxA * 3 + axis];
                    double sb = labFace[idxB * 3 + axis];
                    double dA = sa - value, dB = sb - value;
                    if ((dA > 0 && dB > 0) || (dA < 0 && dB < 0)) return;
                    if (sa == sb) {
                        if (dA == 0) {
                            raw.push_back({labFace[idxA*3+au], labFace[idxA*3+av]});
                            raw.push_back({labFace[idxB*3+au], labFace[idxB*3+av]});
                        }
                        return;
                    }
                    double t = (value - sa) / (sb - sa);
                    raw.push_back({
                        labFace[idxA*3+au] + t * (labFace[idxB*3+au] - labFace[idxA*3+au]),
                        labFace[idxA*3+av] + t * (labFace[idxB*3+av] - labFace[idxA*3+av])
                    });
                };

                for (int u = 0; u < S; u++)
                    for (int w = 0; w <= S; w++)
                        pushCrossing(u*(S+1)+w, (u+1)*(S+1)+w);
                for (int u = 0; u <= S; u++)
                    for (int w = 0; w < S; w++)
                        pushCrossing(u*(S+1)+w, u*(S+1)+(w+1));
            }
        }
    }

    auto hull = convexHull2D(raw);

    json rawJ = json::array();
    for (auto& pt : raw)  rawJ.push_back(json::array({pt[0], pt[1]}));
    json polyJ = json::array();
    for (auto& pt : hull) polyJ.push_back(json::array({pt[0], pt[1]}));

    json result;
    result["axis"]    = (axis == 0) ? "L" : (axis == 1) ? "a" : "b";
    result["value"]   = value;
    result["raw"]     = std::move(rawJ);
    result["polygon"] = std::move(polyJ);
    return result.dump();
}

// ── freeIccProfile ────────────────────────────────────────────────────────────
static void freeIccProfile(int handle) {
    auto it = gIccProfiles.find(handle);
    if (it == gIccProfiles.end()) return;
    auto& p = it->second;
    for (int i = 0; i < 4; i++)
        if (p.xforms[i]) { cmsDeleteTransform(p.xforms[i]); p.xforms[i] = nullptr; }
    if (p.hProfile)  { cmsCloseProfile(p.hProfile); p.hProfile = nullptr; }
    gIccProfiles.erase(it);
}

// ── embind ────────────────────────────────────────────────────────────────────
EMSCRIPTEN_BINDINGS(compwas) {
    emscripten::function("fitModel",          &fitModel);
    emscripten::function("buildGamutMesh",    &buildGamutMesh);
    emscripten::function("buildSlice",        &buildSlice);
    // ICC profile functions
    emscripten::function("loadIccProfile",    &loadIccProfile);
    emscripten::function("evalIccA2B",        &evalIccA2B);
    emscripten::function("evalIccBatch",      &evalIccBatch);
    emscripten::function("buildIccGamutMesh", &buildIccGamutMesh);
    emscripten::function("buildIccSlice",     &buildIccSlice);
    emscripten::function("freeIccProfile",    &freeIccProfile);
}
