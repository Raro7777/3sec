using System;
using System.Collections.Generic;

namespace VolleySim.Domain
{
    /// <summary>
    /// 세트 시작 시점의 로테이션 배치.
    /// <see cref="StartingIds"/>[i] 는 코트 포지션 (i+1) 에 서는 선수 id.
    /// 코트 포지션 번호는 국제 규칙과 동일: 1=후위 오른쪽(서버), 2=전위 오른쪽, 3=전위 중앙,
    /// 4=전위 왼쪽, 5=후위 왼쪽, 6=후위 중앙. 로테이션은 시계방향(2→1→6→5→4→3→2).
    /// </summary>
    public sealed class Lineup
    {
        public string[] StartingIds = new string[6];
        public string LiberoId;
        public List<string> BenchIds = new List<string>();

        /// <summary>
        /// 표준 5-1 배치. 세터가 1번(첫 서버)에서 시작하고 아포짓이 대각(4번)에 선다.
        /// 1:S 2:OH1 3:MB1 4:OP 5:OH2 6:MB2
        /// </summary>
        public static Lineup Standard51(string setter, string oh1, string mb1, string op, string oh2, string mb2, string libero)
        {
            var l = new Lineup();
            l.StartingIds[0] = setter;
            l.StartingIds[1] = oh1;
            l.StartingIds[2] = mb1;
            l.StartingIds[3] = op;
            l.StartingIds[4] = oh2;
            l.StartingIds[5] = mb2;
            l.LiberoId = libero;
            return l;
        }

        public Lineup Clone()
        {
            var l = new Lineup { LiberoId = LiberoId };
            Array.Copy(StartingIds, l.StartingIds, 6);
            l.BenchIds.AddRange(BenchIds);
            return l;
        }
    }
}
