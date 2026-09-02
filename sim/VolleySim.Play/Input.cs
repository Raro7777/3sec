using System.Text;

namespace VolleySim.Play;

/// <summary>입력이 끝났을 때(EOF·스크립트 소진) 상위 루프로 빠져나가기 위한 예외.</summary>
public sealed class InputExhaustedException : Exception
{
    public InputExhaustedException() : base("입력 종료") { }
}

public interface IInput
{
    /// <summary>한 줄 읽기. EOF 면 null.</summary>
    string? ReadLine(string prompt);
    bool Interactive { get; }
}

public sealed class ConsoleInput : IInput
{
    private readonly TextWriter _out;
    public ConsoleInput(TextWriter o) { _out = o; }
    public bool Interactive => true;
    public string? ReadLine(string prompt)
    {
        _out.Write(prompt);
        _out.Flush();
        try { return Console.In.ReadLine(); }
        catch (Exception) { return null; }
    }
}

/// <summary>--script 파일: 줄을 순서대로 공급. '#' 주석과 빈 줄은 건너뛰고, '.' 한 글자는 빈 입력(Enter)으로 준다. 소진되면 null.</summary>
public sealed class ScriptInput : IInput
{
    private readonly Queue<string> _lines = new();
    private readonly TextWriter _out;
    public ScriptInput(IEnumerable<string> lines, TextWriter o)
    {
        _out = o;
        foreach (var l in lines)
        {
            var t = l.Trim();
            if (t.Length == 0 || t.StartsWith('#')) continue;
            _lines.Enqueue(t);
        }
    }
    public bool Interactive => false;
    public string? ReadLine(string prompt)
    {
        if (_lines.Count == 0) { _out.WriteLine(prompt + "<입력 종료>"); return null; }
        var l = _lines.Dequeue();
        if (l == ".") l = "";
        _out.WriteLine(prompt + l);
        return l;
    }
}

/// <summary>화면 출력 + 질문 헬퍼.</summary>
public sealed class Ui
{
    public readonly TextWriter Out;
    public readonly IInput In;
    public Ui(TextWriter o, IInput i) { Out = o; In = i; }

    public void Line(string s = "") => Out.WriteLine(s);
    public void Header(string s) { Out.WriteLine(); Out.WriteLine("══════ " + s + " ══════"); }
    public void Sub(string s) { Out.WriteLine("── " + s + " ──"); }

    /// <summary>한 줄 입력. EOF 면 InputExhaustedException.</summary>
    public string Ask(string prompt)
    {
        var s = In.ReadLine(prompt);
        if (s == null) throw new InputExhaustedException();
        return s.Trim();
    }

    /// <summary>정수 선택. 빈 입력·범위 밖이면 기본값.</summary>
    public int AskInt(string prompt, int min, int max, int def)
    {
        var s = Ask(prompt);
        if (int.TryParse(s, out int v) && v >= min && v <= max) return v;
        return def;
    }

    public bool AskYes(string prompt, bool def = true)
    {
        var s = Ask(prompt + (def ? " [Y/n] " : " [y/N] ")).ToLowerInvariant();
        if (s.Length == 0) return def;
        return s == "y" || s == "yes" || s == "네" || s == "예" || s == "ㅇ";
    }

    public static string Pad(string s, int width)
    {
        // 한글은 2칸으로 계산해 표를 맞춘다.
        int w = 0;
        foreach (var ch in s) w += ch > 0x2E7F ? 2 : 1;
        return s + new string(' ', Math.Max(0, width - w));
    }

    public static string Bar(double cur, double max, int width = 10)
    {
        if (max <= 0) return new string('░', width);
        int filled = (int)Math.Round(width * Math.Clamp(cur / max, 0, 1));
        return new string('█', filled) + new string('░', width - filled);
    }
}
