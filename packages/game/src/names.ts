/**
 * Player and manager names by nationality, in Korean transliteration: the league is Korean, the
 * continental field is not, and a squad list reads wrong when a club from Osaka is full of 김민준s.
 */
import type { Rng } from "@3sec/engine";

export type Nationality = "한국" | "일본" | "중국" | "호주" | "태국" | "베트남";

const JP_SURNAME = ["사토", "스즈키", "다카하시", "다나카", "와타나베", "이토", "야마모토", "나카무라", "고바야시", "가토", "요시다", "야마다", "사사키", "야마구치", "마쓰모토", "이노우에", "기무라", "하야시", "시미즈", "야마자키", "모리", "이케다", "하시모토", "아베", "이시카와", "나카지마", "마에다", "후지타", "오가와", "고토", "오카다", "하세가와", "무라카미", "곤도", "이시이", "사이토", "사카모토", "엔도", "아오키", "후지이"];
const JP_GIVEN = ["유토", "하루토", "소타", "유마", "리쿠", "다이키", "쇼타", "겐토", "가이토", "료", "다쿠미", "고키", "유키", "히로키", "레오", "다이스케", "겐타", "쇼", "유야", "나오키", "고타", "슌", "아키라", "가즈키", "리쿠토", "하루키", "료타", "다이치", "유스케", "게이스케"];
const CN_SURNAME = ["왕", "리", "장", "류", "천", "양", "황", "자오", "우", "저우", "쉬", "쑨", "마", "주", "후", "궈", "허", "가오", "린", "뤄", "정", "량", "셰", "쑹", "탕", "한", "펑", "덩", "차오", "샤오"];
const CN_GIVEN = ["하오", "웨이", "레이", "이", "쥔", "펑", "타오", "위", "밍", "차오", "린", "보", "룽", "강", "신", "톈", "제", "천", "위안", "자하오", "쯔밍", "위저", "하오란", "쥔제", "이판", "쯔이", "루이", "쉬안", "웨이하오", "하오위"];
const AU_GIVEN = ["잭", "톰", "리암", "노아", "올리버", "루카스", "제임스", "벤", "코너", "라일리", "하비", "매슈", "다니엘", "샘", "조시", "미첼", "라클란", "칼럼", "네이선", "애덤", "카일", "브랜던", "딜런", "코디", "재러드"];
const AU_SURNAME = ["톰슨", "윌슨", "테일러", "존슨", "화이트", "마틴", "앤더슨", "브라운", "밀러", "무어", "라이언", "켈리", "머피", "워커", "스콧", "그린", "베이커", "휴즈", "카터", "미첼", "로버츠", "에번스", "콜린스", "쿡", "베넷", "워드", "코스타", "리치", "페리", "그랜트"];
const TH_GIVEN = ["티라톤", "차나팁", "산티", "타나", "수파촉", "위라텝", "폰", "낫", "타나와트", "피니트", "웍", "에카닛", "사라치", "아누촉", "폰차이", "자툰", "타위", "수라차이", "니티", "차이야"];
const TH_SURNAME = ["분마탄", "송크라신", "부아프롬", "자이야", "위롯", "촉차이", "수완", "라타나", "카웨", "프라솜", "탐마롱", "카노크", "삼란", "찬타", "위차이"];
const VN_SURNAME = ["응우옌", "쩐", "레", "팜", "호앙", "부", "당", "부이", "도", "호", "응오", "즈엉", "리"];
const VN_GIVEN = ["반 남", "꽝 하이", "꽁 푸엉", "반 토안", "띠엔 린", "반 하우", "주이 마인", "쑤언 쯔엉", "반 득", "호앙 득", "딘 쫑", "탄 쭝", "쭝 하이", "반 럼", "꾸옥 안", "밍 브엉", "반 뀌엣", "티엔 중", "탄 빈", "훙 중"];

const KO_FIRST = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권", "황", "안", "송", "류", "홍", "문", "양", "배", "백", "남"];
const KO_GIVEN = ["민준", "서준", "도윤", "예준", "시우", "하준", "지호", "주원", "지훈", "준서", "현우", "우진", "선우", "은우", "재윤", "태양", "유준", "승민", "도현", "건우", "민석", "진우", "상호", "영진", "경민", "태현", "성민", "동현", "재현", "승현"];

/** A random name of the nationality; every branch draws the rng exactly twice so squads stay reproducible. */
export function nameFor(rng: Rng, nat: Nationality): string {
  switch (nat) {
    case "일본": return `${rng.pick(JP_SURNAME)} ${rng.pick(JP_GIVEN)}`;
    case "중국": return `${rng.pick(CN_SURNAME)} ${rng.pick(CN_GIVEN)}`;
    case "호주": return `${rng.pick(AU_GIVEN)} ${rng.pick(AU_SURNAME)}`;
    case "태국": return `${rng.pick(TH_GIVEN)} ${rng.pick(TH_SURNAME)}`;
    case "베트남": return `${rng.pick(VN_SURNAME)} ${rng.pick(VN_GIVEN)}`;
    default: return `${rng.pick(KO_FIRST)}${rng.pick(KO_GIVEN)}`;
  }
}

/** Short label for a foreign player's badge: 🇯🇵 is not available in every font, so a two-letter code. */
export const NAT_CODE: Record<Nationality, string> = { 한국: "KOR", 일본: "JPN", 중국: "CHN", 호주: "AUS", 태국: "THA", 베트남: "VNM" };
export const NATIONALITIES: Nationality[] = ["한국", "일본", "중국", "호주", "태국", "베트남"];
