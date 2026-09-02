using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace VolleySim.Data
{
    /// <summary>
    /// 의존성 없는 최소 JSON 파서. netstandard2.1 에는 System.Text.Json 이 내장되어 있지 않고
    /// (NuGet 패키지 필요) Unity 호환·무의존 원칙을 지키기 위해 자체 구현한다.
    /// 결과: object = Dictionary&lt;string, object&gt; / List&lt;object&gt; / string / double / bool / null.
    /// 관대한 확장: // 줄 주석, /* */ 블록 주석, 후행 콤마 허용(수작업 데이터 파일 대비).
    /// </summary>
    public static class MiniJson
    {
        public static object Parse(string json)
        {
            if (json == null) throw new ArgumentNullException(nameof(json));
            var p = new Parser(json);
            p.SkipWs();
            var v = p.ParseValue();
            p.SkipWs();
            if (!p.End) throw p.Error("Trailing characters");
            return v;
        }

        // ---- 편의 접근자 ----

        public static Dictionary<string, object> AsObject(object v) => v as Dictionary<string, object>;
        public static List<object> AsArray(object v) => v as List<object>;

        public static string GetString(Dictionary<string, object> o, string key, string fallback = "")
        {
            if (o == null || !o.TryGetValue(key, out var v) || v == null) return fallback;
            return v is string s ? s : Convert.ToString(v, CultureInfo.InvariantCulture);
        }

        public static int GetInt(Dictionary<string, object> o, string key, int fallback = 0)
        {
            if (o == null || !o.TryGetValue(key, out var v) || v == null) return fallback;
            if (v is double d) return (int)Math.Round(d);
            if (v is string s && int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var i)) return i;
            return fallback;
        }

        public static double GetDouble(Dictionary<string, object> o, string key, double fallback = 0)
        {
            if (o == null || !o.TryGetValue(key, out var v) || v == null) return fallback;
            if (v is double d) return d;
            if (v is string s && double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var x)) return x;
            return fallback;
        }

        public static Dictionary<string, object> GetObject(Dictionary<string, object> o, string key)
        {
            if (o == null || !o.TryGetValue(key, out var v)) return null;
            return v as Dictionary<string, object>;
        }

        public static List<object> GetArray(Dictionary<string, object> o, string key)
        {
            if (o == null || !o.TryGetValue(key, out var v)) return null;
            return v as List<object>;
        }

        // ---- 파서 ----

        private sealed class Parser
        {
            private readonly string _s;
            private int _i;

            public Parser(string s) { _s = s; }

            public bool End => _i >= _s.Length;

            public Exception Error(string msg) => new FormatException($"JSON parse error at {_i}: {msg}");

            public void SkipWs()
            {
                while (_i < _s.Length)
                {
                    char c = _s[_i];
                    if (c == ' ' || c == '\t' || c == '\n' || c == '\r') { _i++; continue; }
                    if (c == '/' && _i + 1 < _s.Length)
                    {
                        if (_s[_i + 1] == '/')
                        {
                            _i += 2;
                            while (_i < _s.Length && _s[_i] != '\n') _i++;
                            continue;
                        }
                        if (_s[_i + 1] == '*')
                        {
                            _i += 2;
                            while (_i + 1 < _s.Length && !(_s[_i] == '*' && _s[_i + 1] == '/')) _i++;
                            _i += 2;
                            continue;
                        }
                    }
                    break;
                }
            }

            public object ParseValue()
            {
                if (End) throw Error("Unexpected end");
                char c = _s[_i];
                switch (c)
                {
                    case '{': return ParseObject();
                    case '[': return ParseArray();
                    case '"': return ParseString();
                    case 't': Expect("true"); return true;
                    case 'f': Expect("false"); return false;
                    case 'n': Expect("null"); return null;
                    default:
                        if (c == '-' || (c >= '0' && c <= '9')) return ParseNumber();
                        throw Error($"Unexpected character '{c}'");
                }
            }

            private void Expect(string word)
            {
                if (string.CompareOrdinal(_s, _i, word, 0, word.Length) != 0) throw Error($"Expected {word}");
                _i += word.Length;
            }

            private Dictionary<string, object> ParseObject()
            {
                var o = new Dictionary<string, object>(StringComparer.Ordinal);
                _i++; // {
                SkipWs();
                if (!End && _s[_i] == '}') { _i++; return o; }
                while (true)
                {
                    SkipWs();
                    if (End) throw Error("Unterminated object");
                    if (_s[_i] == '}') { _i++; return o; } // 후행 콤마 허용
                    if (_s[_i] != '"') throw Error("Expected string key");
                    string key = ParseString();
                    SkipWs();
                    if (End || _s[_i] != ':') throw Error("Expected ':'");
                    _i++;
                    SkipWs();
                    o[key] = ParseValue();
                    SkipWs();
                    if (End) throw Error("Unterminated object");
                    if (_s[_i] == ',') { _i++; continue; }
                    if (_s[_i] == '}') { _i++; return o; }
                    throw Error("Expected ',' or '}'");
                }
            }

            private List<object> ParseArray()
            {
                var a = new List<object>();
                _i++; // [
                SkipWs();
                if (!End && _s[_i] == ']') { _i++; return a; }
                while (true)
                {
                    SkipWs();
                    if (End) throw Error("Unterminated array");
                    if (_s[_i] == ']') { _i++; return a; } // 후행 콤마 허용
                    a.Add(ParseValue());
                    SkipWs();
                    if (End) throw Error("Unterminated array");
                    if (_s[_i] == ',') { _i++; continue; }
                    if (_s[_i] == ']') { _i++; return a; }
                    throw Error("Expected ',' or ']'");
                }
            }

            private string ParseString()
            {
                _i++; // "
                var sb = new StringBuilder();
                while (true)
                {
                    if (End) throw Error("Unterminated string");
                    char c = _s[_i++];
                    if (c == '"') break;
                    if (c != '\\') { sb.Append(c); continue; }
                    if (End) throw Error("Bad escape");
                    char e = _s[_i++];
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (_i + 4 > _s.Length) throw Error("Bad unicode escape");
                            sb.Append((char)int.Parse(_s.Substring(_i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                            _i += 4;
                            break;
                        default: throw Error($"Bad escape '\\{e}'");
                    }
                }
                return sb.ToString();
            }

            private double ParseNumber()
            {
                int start = _i;
                if (_s[_i] == '-') _i++;
                while (_i < _s.Length)
                {
                    char c = _s[_i];
                    if ((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') _i++;
                    else break;
                }
                string num = _s.Substring(start, _i - start);
                if (!double.TryParse(num, NumberStyles.Float, CultureInfo.InvariantCulture, out var d)) throw Error($"Bad number '{num}'");
                return d;
            }
        }
    }
}
