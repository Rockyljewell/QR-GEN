// Copyright 2026 QR-GEN contributors
// SPDX-License-Identifier: Apache-2.0
// Diagnostic-only bounded stderr transport. No decoder thresholds or decisions.
#pragma once

#ifdef ZXING_QRGEN_ROW_TRACE
#include <array>
#include <bit>
#include <cstdint>
#include <cstdio>
#include <cmath>
#include <string_view>
#include <type_traits>

namespace ZXing::QRGenTrace {
inline constexpr uint64_t MAX_EVENTS = 250000;
inline constexpr uint64_t MAX_BYTES = 32 * 1024 * 1024;
inline constexpr size_t MAX_LINE = 16384;
struct State {
    bool active = false, ean = false;
    uint64_t serial = 0, events = 0, bytes = 0, dropped = 0, oversized = 0, nonFiniteFields = 0;
    uint64_t passes = 0, rows = 0, attempts = 0, candidates = 0, groups = 0;
    uint64_t pass = 0, row = 0, attempt = 0, candidate = 0;
    int reader = -1, rowNumber = -1, layerWidth = 0, layerHeight = 0;
    int originalWidth = 0, originalHeight = 0, close = 0, invert = 0;
    bool rotate = false, reverse = false;
};
inline thread_local State state;

// All event storage is fixed-size. An overflow drops the event and is reported
// by call-end; no output truncation is allowed to influence recognition.
class Event {
    std::array<char, MAX_LINE> _buf{};
    size_t _size = 0;
    bool _ok = true, _force = false;
    template<typename... Args> void append(const char* fmt, Args... args) noexcept {
        if (!_ok) return;
        int n = std::snprintf(_buf.data() + _size, _buf.size() - _size, fmt, args...);
        if (n < 0 || static_cast<size_t>(n) >= _buf.size() - _size) { _ok = false; return; }
        _size += static_cast<size_t>(n);
    }
    void quoted(std::string_view value) noexcept {
        append("\"");
        for (unsigned char c : value) {
            if (c == '"' || c == '\\') append("\\%c", c);
            else if (c < 32 || c >= 127) append("\\u%04x", static_cast<unsigned>(c));
            else append("%c", c);
        }
        append("\"");
    }
    void numeric(double value) noexcept {
        if (std::isfinite(value)) append("%.17g", value);
        else { ++state.nonFiniteFields; quoted(std::isnan(value) ? "NaN" : (value < 0 ? "-Infinity" : "+Infinity")); }
    }
public:
    explicit Event(const char* type, bool force = false) noexcept : _force(force) {
        append("QRGEN_ROW_TRACE {\"schema\":1,\"event\":"); quoted(type);
        number("seq", ++state.serial); number("pass", state.pass);
        number("rowId", state.row); number("attempt", state.attempt);
        number("candidate", state.candidate); number("reader", state.reader);
        number("rowNumber", state.rowNumber); boolean("rotate", state.rotate);
        boolean("reverse", state.reverse);
    }
    Event(const Event&) = delete;
    ~Event() noexcept {
        append("}\n");
        if (!_ok) { ++state.oversized; return; }
        if (!_force && (state.events >= MAX_EVENTS || state.bytes + _size > MAX_BYTES)) {
            ++state.dropped; return;
        }
        if (std::fwrite(_buf.data(), 1, _size, stderr) != _size) ++state.dropped;
        ++state.events; state.bytes += _size;
    }
    template<typename T> void number(const char* key, T value) noexcept {
        append(",\"%s\":%lld", key, static_cast<long long>(value));
    }
    void real(const char* key, double value) noexcept { append(",\"%s\":", key); numeric(value); }
    void float64Bits(const char* key, double value) noexcept {
        append(",\"%s\":\"%016llx\"", key, static_cast<unsigned long long>(std::bit_cast<uint64_t>(value)));
    }
    void boolean(const char* key, bool value) noexcept { append(",\"%s\":%s", key, value ? "true" : "false"); }
    void text(const char* key, std::string_view value) noexcept { append(",\"%s\":", key); quoted(value); }
    template<typename Range> void array(const char* key, const Range& range) noexcept {
        append(",\"%s\":[", key); bool first = true;
        for (const auto& value : range) {
            if (!first) append(","); first = false;
            if constexpr (std::is_floating_point_v<std::remove_cvref_t<decltype(value)>>)
                numeric(static_cast<double>(value));
            else append("%lld", static_cast<long long>(value));
        }
        append("]");
    }
    template<typename Position> void position(const char* key, const Position& pos) noexcept {
        append(",\"%s\":[", key); bool first = true;
        for (const auto& p : pos) { if (!first) append(","); first = false; append("[%d,%d]", p.x, p.y); }
        append("]");
    }
    template<typename View> void view(const char* key, const View& view) noexcept {
        boolean("viewValid", view.isValid());
        if (view.isValid()) { number("runIndex", view.index()); number("x0", view.pixelsInFront());
            number("x1", view.pixelsTillEnd()); array(key, view); }
    }
};

struct Call {
    explicit Call(int width, int height) noexcept {
        state = {}; state.active = true; state.originalWidth = width; state.originalHeight = height;
        Event e("call-begin", true); e.number("width", width); e.number("height", height);
        e.number("maxEvents", MAX_EVENTS); e.number("maxBytes", MAX_BYTES); e.number("maxLine", MAX_LINE);
    }
    ~Call() noexcept {
        { Event e("call-end", true); e.number("priorEvents", state.events); e.number("priorBytes", state.bytes);
          e.number("dropped", state.dropped); e.number("oversized", state.oversized);
          e.number("nonFiniteFields", state.nonFiniteFields);
          e.number("passes", state.passes); e.number("rows", state.rows); e.number("attempts", state.attempts);
          e.number("candidates", state.candidates); e.number("groups", state.groups); }
        state.active = false;
    }
};
struct EANScope {
    bool old;
    EANScope() noexcept : old(state.ean) { state.ean = true; }
    ~EANScope() noexcept { state.ean = old; }
};

template<typename View, typename Pattern>
double GuardValue(const View& view, const Pattern& pattern, int quietPixels, double quietModules,
                  double moduleRef, double result, const char* algorithm, int exitSite) noexcept {
    if (state.active && state.ean) {
        Event e("guard-test"); e.text("algorithm", algorithm); e.number("exitSite", exitSite);
        e.view("runs", view); e.array("pattern", pattern); e.number("quietPixels", quietPixels);
        e.real("quietModules", quietModules); e.real("moduleRef", moduleRef); e.real("result", result);
        e.float64Bits("moduleRefFloat64Bits", moduleRef); e.float64Bits("resultFloat64Bits", result);
    }
    return result;
}
// Stable IDs in this bounded study; the capacity is independent of the result
// limit. If exceeded, IDs become zero and call-end reports oversized coverage.
struct GroupIds {
    std::array<uint64_t, 8192> ids{};
    void inserted(size_t index) noexcept {
        auto id = ++state.groups;
        if (index < ids.size()) ids[index] = id; else ++state.oversized;
    }
    uint64_t at(size_t index) const noexcept { return index < ids.size() ? ids[index] : 0; }
    template<typename Results, typename Pred> void beforeErase(const Results& results, Pred remove) noexcept {
        size_t to = 0;
        for (size_t from = 0; from < results.size(); ++from) if (!remove(results[from])) {
            if (to < ids.size()) ids[to] = at(from); ++to;
        }
    }
};
} // namespace ZXing::QRGenTrace
#define QRT(NAME, BODY) do { if (::ZXing::QRGenTrace::state.active) { ::ZXing::QRGenTrace::Event qrt(NAME); BODY; } } while (false)
#define QRT_EAN(NAME, BODY) do { if (::ZXing::QRGenTrace::state.ean) { QRT(NAME, BODY); } } while (false)
#define QRT_ONLY(...) __VA_ARGS__
#define QRT_GUARD(V, P, Q, M, R, RESULT, ALG) ::ZXing::QRGenTrace::GuardValue(V, P, Q, M, R, RESULT, ALG, __LINE__)
#define QRT_BOOL(NAME, VALUE, BODY) ([&]() { const bool qrtDecision = (VALUE); QRT(NAME, qrt.boolean("decision", qrtDecision); BODY); return qrtDecision; }())
#else
#define QRT(NAME, BODY) do {} while (false)
#define QRT_EAN(NAME, BODY) do {} while (false)
#define QRT_ONLY(...)
#define QRT_GUARD(V, P, Q, M, R, RESULT, ALG) (RESULT)
#define QRT_BOOL(NAME, VALUE, BODY) (VALUE)
#endif
