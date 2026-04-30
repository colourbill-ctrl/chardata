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

#include <algorithm>
#include <array>
#include <cmath>
#include <functional>
#include <stdexcept>
#include <string>
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

// ── embind ────────────────────────────────────────────────────────────────────
EMSCRIPTEN_BINDINGS(compwas) {
    emscripten::function("fitModel",       &fitModel);
    emscripten::function("buildGamutMesh", &buildGamutMesh);
    emscripten::function("buildSlice",     &buildSlice);
}
