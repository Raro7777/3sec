import { describe, expect, it } from "vitest";
import { ROSTER_FORMAT, applyRoster, buildClubs, deserialize, newGame, parseRoster, rosterTemplate, serialize, overall, seasonOver, simulateRound, advanceRound } from "../src/index";

const pack = () => ({
  format: ROSTER_FORMAT,
  name: "테스트 팩",
  clubs: [
    { slot: 0, name: "서울 리얼", shortName: "서리", color: "#112233", stadium: "리얼 파크", capacity: 50000, players: [
      { name: "골키퍼 A", age: 29, role: "GK", number: 1, rating: 14 },
      { name: "수비수 B", age: 24, role: "CB" },
      { name: "공격수 C", age: 21, role: "ST", number: 9, rating: 16, potential: 19 },
    ] },
    { slot: 23, name: "정선 리얼", shortName: "정리", reputation: 12.5 },
  ],
});

describe("로스터 팩", () => {
  it("parses a good pack and reports every problem of a bad one in Korean", () => {
    const ok = parseRoster(JSON.stringify(pack()));
    expect(ok.errors).toEqual([]);
    expect(ok.pack?.clubs.length).toBe(2);
    const bad = parseRoster(JSON.stringify({ format: "x", clubs: [{ slot: 99, name: "" }, { slot: 1, name: "A", players: [{ name: "P", age: 3, role: "XX" }] }] }));
    expect(bad.pack).toBeNull();
    expect(bad.errors.join(" ")).toMatch(/format/);
    expect(bad.errors.join(" ")).toMatch(/slot/);
    expect(bad.errors.join(" ")).toMatch(/age/);
    expect(parseRoster("{").errors[0]).toMatch(/JSON/);
  });

  it("renames the slot, keeps its id and division, and rebuilds a playable squad around the listed players", () => {
    const clubs = buildClubs(5);
    const before = clubs[0]!.name;
    applyRoster(clubs, parseRoster(JSON.stringify(pack())).pack!, 5);
    const c = clubs[0]!;
    expect(c.id).toBe(0);
    expect(c.division).toBe(1);
    expect(c.name).toBe("서울 리얼");
    expect(c.baseName).toBe(before);
    expect(c.stadiumName).toBe("리얼 파크");
    expect(c.capacity).toBe(50000);
    // the three named players are there, topped up to a full squad with two keepers
    expect(c.squad.filter((p) => ["골키퍼 A", "수비수 B", "공격수 C"].includes(p.name)).length).toBe(3);
    expect(c.squad.length).toBeGreaterThanOrEqual(18);
    expect(c.squad.filter((p) => p.role === "GK").length).toBeGreaterThanOrEqual(2);
    expect(c.selection.starters.length).toBe(11);
    // a rated player lands near his rating; potential is honoured
    const st = c.squad.find((p) => p.name === "공격수 C")!;
    expect(Math.abs(overall(st.attrs, "ST") - 16)).toBeLessThan(1.5);
    expect(st.potential).toBe(19);
    expect(st.number).toBe(9);
    // a slot with only a reputation keeps its generated squad but takes the new level and budget
    const d2 = clubs[23]!;
    expect(d2.name).toBe("정선 리얼");
    expect(d2.reputation).toBe(12.5);
    expect(d2.squad.length).toBe(20);
    // untouched slots are untouched
    expect(clubs[5]!.name).toBe(buildClubs(5)[5]!.name);
  });

  it("starts a game on a pack, remembers its name in the save, and plays a round", () => {
    const s = newGame(9, 0, "감독", "normal", parseRoster(JSON.stringify(pack())).pack);
    expect(s.roster).toBe("테스트 팩");
    expect(s.clubs[0]!.name).toBe("서울 리얼");
    const back = deserialize(serialize(s))!;
    expect(back.roster).toBe("테스트 팩");
    expect(back.clubs[0]!.squad.some((p) => p.name === "공격수 C")).toBe(true);
    simulateRound(s, { halfLength: 60 });
    advanceRound(s);
    expect(seasonOver(s)).toBe(false);
    expect(s.round).toBe(1);
  });

  it("offers a template naming every slot after the club it replaces", () => {
    const t = rosterTemplate(buildClubs(1));
    expect(t.clubs.length).toBe(24);
    expect(t.clubs[12]!.slot).toBe(12);
    expect(parseRoster(JSON.stringify(t)).errors).toEqual([]);
  });
});
