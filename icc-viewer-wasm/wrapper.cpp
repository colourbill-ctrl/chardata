// (c) William Li 2026
/**
 * icc-viewer WASM wrapper for chardata.
 *
 * Lifted from profiletool's validator-wasm/wrapper.cpp — kept in sync so a
 * profile-viewer JSON shape is identical across the two apps. Exposes:
 *
 *   validateProfile(Uint8Array) → JSON   (header + tags + validation)
 *   describeTag(Uint8Array, sig) → JSON  (full-verbosity Describe() for one tag)
 *
 * Built with Emscripten as a separate ES module from chardata-gamut.{mjs,wasm}
 * and lazy-loaded by index.html when the user clicks "Display File" on an ICC
 * profile slot. chardata-gamut keeps using lcms2 for transforms.
 */

#include "IccProfile.h"
#include "IccTag.h"
#include "IccUtil.h"
#include "IccProfLibVer.h"
#include "icProfileHeader.h"

#include <nlohmann/json.hpp>
#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <cstdint>
#include <sstream>
#include <string>
#include <vector>

using json = nlohmann::json;

static std::string sigToStr(icUInt32Number sig) {
  if (sig == 0) return "NULL";
  char buf[5];
  buf[0] = static_cast<char>((sig >> 24) & 0xFF);
  buf[1] = static_cast<char>((sig >> 16) & 0xFF);
  buf[2] = static_cast<char>((sig >>  8) & 0xFF);
  buf[3] = static_cast<char>( sig        & 0xFF);
  buf[4] = '\0';
  for (int i = 0; i < 4; ++i)
    if (buf[i] < 0x20 || buf[i] > 0x7E) buf[i] = '?';
  return std::string(buf);
}

static std::string formatSpectralRange(const icSpectralRange& r) {
  if (r.start == 0 && r.end == 0 && r.steps == 0) return "Not Defined";
  char buf[64];
  snprintf(buf, sizeof(buf), "start=%.1fnm, end=%.1fnm, steps=%u",
           static_cast<double>(icF16toF(r.start)),
           static_cast<double>(icF16toF(r.end)),
           static_cast<unsigned>(r.steps));
  return std::string(buf);
}

// Reject obviously-bad sizes before IccProfLib parses untrusted bytes — mirrors
// the 32 MB / 128-byte guard in gamut-wrapper.cpp's loadIccProfile. Returns a
// JSON error string when the input is out of range, or an empty string when OK.
static std::string iccSizeGuard(std::size_t len) {
  // Typical ICC files are <2 MB; cap at 32 MB to protect the WASM heap from DoS
  // via a maliciously huge profile.
  if (len > 32u * 1024u * 1024u) {
    return json{{"error", "profile too large (>32 MB)"}}.dump();
  }
  // ICC v2/v4 header is 128 bytes minimum (the magic check at offset 36 also
  // requires this); reject obviously-truncated input.
  if (len < 128) {
    return json{{"error", "profile too small (<128 bytes)"}}.dump();
  }
  return std::string();
}

static std::string validateBytes(const std::uint8_t* data, std::size_t len) {
  std::string sizeErr = iccSizeGuard(len);
  if (!sizeErr.empty()) return sizeErr;

  std::string sReport;
  icValidateStatus nStatus = icValidateOK;
  CIccProfile* pProfile = ValidateIccProfile(
      data, static_cast<icUInt32Number>(len), sReport, nStatus);

  if (!pProfile) {
    json err = {{"error", "Failed to parse ICC profile"}};
    return err.dump();
  }

  json result;
  result["libraryVersion"] = ICCPROFLIBVER;

  const icHeader& hdr = pProfile->m_Header;
  char idHex[33];
  for (int i = 0; i < 16; ++i)
    snprintf(idHex + i * 2, 3, "%02x", hdr.profileID.ID8[i]);
  result["profileId"]    = std::string(idHex);
  result["sizeBytes"]    = static_cast<int>(hdr.size);
  char hexBuf[16];
  snprintf(hexBuf, sizeof(hexBuf), "%x", hdr.size);
  result["sizeBytesHex"] = std::string(hexBuf);

  CIccInfo info;
  json header;

  header["Attributes"]          = std::string(info.GetDeviceAttrName(hdr.attributes));
  header["Cmm"]                 = std::string(info.GetCmmSigName(static_cast<icCmmSignature>(hdr.cmmId)));
  {
    char dateBuf[64];
    snprintf(dateBuf, sizeof(dateBuf), "%d/%d/%d (M/D/Y)  %02d:%02d:%02d",
             static_cast<int>(hdr.date.month), static_cast<int>(hdr.date.day),
             static_cast<int>(hdr.date.year),
             static_cast<int>(hdr.date.hours), static_cast<int>(hdr.date.minutes),
             static_cast<int>(hdr.date.seconds));
    header["Creation Date"] = std::string(dateBuf);
  }
  header["Creator"]             = sigToStr(hdr.creator);
  header["Device Manufacturer"] = sigToStr(hdr.manufacturer);
  header["Data Color Space"]    = std::string(info.GetColorSpaceSigName(hdr.colorSpace));
  header["Flags"]               = std::string(info.GetProfileFlagsName(hdr.flags));
  header["PCS Color Space"]     = std::string(info.GetColorSpaceSigName(hdr.pcs));
  header["Platform"]            = std::string(info.GetPlatformSigName(hdr.platform));
  header["Rendering Intent"]    = std::string(info.GetRenderingIntentName(
                                     static_cast<icRenderingIntent>(hdr.renderingIntent)));
  header["Profile Class"]       = std::string(info.GetProfileClassSigName(hdr.deviceClass));
  header["Profile SubClass"]    = (hdr.deviceSubClass != 0)
                                    ? sigToStr(hdr.deviceSubClass)
                                    : "Not Defined";
  header["Version"]             = std::string(info.GetVersionName(hdr.version));
  {
    char illumBuf[64];
    snprintf(illumBuf, sizeof(illumBuf), "X=%.4f, Y=%.4f, Z=%.4f",
             static_cast<double>(icFtoD(hdr.illuminant.X)),
             static_cast<double>(icFtoD(hdr.illuminant.Y)),
             static_cast<double>(icFtoD(hdr.illuminant.Z)));
    header["Illuminant"] = std::string(illumBuf);
  }
  header["Spectral PCS"]        = (hdr.spectralPCS != icSigNoSpectralData)
                                    ? std::string(info.GetSpectralColorSigName(
                                        static_cast<icColorSpaceSignature>(hdr.spectralPCS)))
                                    : "NoSpectralData";
  header["Spectral PCS Range"]  = formatSpectralRange(hdr.spectralRange);
  header["BiSpectral Range"]    = formatSpectralRange(hdr.biSpectralRange);
  header["MCS Color Space"]     = (hdr.mcs != 0) ? sigToStr(hdr.mcs) : "Not Defined";

  result["header"] = header;

  struct TagRow {
    std::string name;
    std::string id;
    std::string type;
    std::string description;
    bool isArrayType = false;
    icUInt32Number offset;
    icUInt32Number size;
  };

  std::vector<TagRow> rows;
  rows.reserve(pProfile->m_Tags.size());

  for (const auto& entry : pProfile->m_Tags) {
    TagRow r;
    r.name   = std::string(info.GetTagSigName(entry.TagInfo.sig));
    r.id     = sigToStr(static_cast<icUInt32Number>(entry.TagInfo.sig));
    r.offset = entry.TagInfo.offset;
    r.size   = entry.TagInfo.size;
    if (entry.pTag) {
      r.type = std::string(info.GetTagTypeSigName(entry.pTag->GetType()));
      r.isArrayType = entry.pTag->IsArrayType();
      // Verbosity 75 keeps CLUT cells / curve points out of the upfront pass —
      // describeTag() fetches verbosity-100 on demand when a row is expanded.
      entry.pTag->Describe(r.description, 75);
    } else {
      r.description = "Tag not found in profile.";
    }
    rows.push_back(std::move(r));
  }

  std::stable_sort(rows.begin(), rows.end(),
    [](const TagRow& a, const TagRow& b){ return a.offset < b.offset; });

  json tags = json::array();
  for (std::size_t i = 0; i < rows.size(); ++i) {
    json t;
    t["name"]        = rows[i].name;
    t["id"]          = rows[i].id;
    t["type"]        = rows[i].type;
    t["isArrayType"] = rows[i].isArrayType;
    t["description"] = rows[i].description;
    t["offset"]      = static_cast<int>(rows[i].offset);
    t["size"]        = static_cast<int>(rows[i].size);
    int pad;
    if (i + 1 < rows.size()) {
      pad = static_cast<int>(rows[i + 1].offset)
          - static_cast<int>(rows[i].offset + rows[i].size);
    } else {
      pad = static_cast<int>(hdr.size)
          - static_cast<int>(rows[i].offset + rows[i].size);
    }
    t["pad"] = pad;
    tags.push_back(std::move(t));
  }
  result["tags"] = tags;

  json validation;
  std::string level, statusStr;
  switch (nStatus) {
    case icValidateOK:            level = "valid";   statusStr = "Profile is valid"; break;
    case icValidateWarning:       level = "warning"; statusStr = "Profile has warning(s)"; break;
    case icValidateNonCompliant:  level = "error";   statusStr = "Profile is non-compliant"; break;
    case icValidateCriticalError: level = "error";   statusStr = "Critical validation error"; break;
    default:                      level = "unknown"; statusStr = "Unknown validation status";
  }
  validation["level"]  = level;
  validation["status"] = statusStr;

  json messages = json::array();
  {
    std::istringstream ss(sReport);
    std::string line;
    while (std::getline(ss, line)) {
      while (!line.empty() && (line.back() == '\r' || line.back() == ' ' || line.back() == '\t'))
        line.pop_back();
      if (!line.empty()) messages.push_back(line);
    }
  }
  validation["messages"] = messages;
  result["validation"]   = validation;

  delete pProfile;

  return result.dump(2, ' ', false, json::error_handler_t::replace);
}

static std::string validateProfile(emscripten::val bytes) {
  try {
    auto vec = emscripten::convertJSArrayToNumberVector<std::uint8_t>(bytes);
    return validateBytes(vec.data(), vec.size());
  } catch (const std::exception& e) {
    json err = {{"error", std::string("validator threw: ") + e.what()}};
    return err.dump();
  } catch (...) {
    json err = {{"error", "validator threw an unknown exception"}};
    return err.dump();
  }
}

static std::string describeTagBytes(const std::uint8_t* data, std::size_t len,
                                    const std::string& tagSig) {
  if (tagSig.size() != 4) {
    return json{{"error", "tagSig must be a 4-character ICC signature"}}.dump();
  }
  icUInt32Number sig =
      (static_cast<icUInt32Number>(static_cast<unsigned char>(tagSig[0])) << 24) |
      (static_cast<icUInt32Number>(static_cast<unsigned char>(tagSig[1])) << 16) |
      (static_cast<icUInt32Number>(static_cast<unsigned char>(tagSig[2])) <<  8) |
      (static_cast<icUInt32Number>(static_cast<unsigned char>(tagSig[3])));

  std::string sizeErr = iccSizeGuard(len);
  if (!sizeErr.empty()) return sizeErr;

  std::string sReport;
  icValidateStatus nStatus = icValidateOK;
  CIccProfile* pProfile = ValidateIccProfile(
      data, static_cast<icUInt32Number>(len), sReport, nStatus);
  if (!pProfile) {
    return json{{"error", "Failed to parse ICC profile"}}.dump();
  }

  CIccTag* pTag = pProfile->FindTag(static_cast<icSignature>(sig));
  if (!pTag) {
    delete pProfile;
    return json{{"error", "Tag not found: " + tagSig}}.dump();
  }

  std::string description;
  pTag->Describe(description, 100);
  delete pProfile;
  return json{{"description", description}}.dump(
      -1, ' ', false, json::error_handler_t::replace);
}

static std::string describeTag(emscripten::val bytes, std::string tagSig) {
  try {
    auto vec = emscripten::convertJSArrayToNumberVector<std::uint8_t>(bytes);
    return describeTagBytes(vec.data(), vec.size(), tagSig);
  } catch (const std::exception& e) {
    return json{{"error", std::string("describeTag threw: ") + e.what()}}.dump();
  } catch (...) {
    return json{{"error", "describeTag threw an unknown exception"}}.dump();
  }
}

EMSCRIPTEN_BINDINGS(icc_viewer) {
  emscripten::function("validateProfile", &validateProfile);
  emscripten::function("describeTag", &describeTag);
}
