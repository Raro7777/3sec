export interface ParsedReceipt {
    merchantName?: string;
    amount?: number;
    paidAt?: Date;
    category?: string;
}

export function parseReceiptText(text: string): ParsedReceipt {
    const result: ParsedReceipt = {};
    const lines = text.split(/\s{2,}|[\n\r]/).map(l => l.trim()).filter(l => l.length > 0);
    const fullTextStr = lines.join(' ');
    // 모든 공백을 제거한 텍스트로, 여백 오인식에 의한 파싱 오류를 방지합니다.
    const spacelessText = fullTextStr.replace(/\s+/g, '');

    // 1. 카테고리(Category) 자동 추론
    const textForCategory = spacelessText.toLowerCase();
    
    const foodKeywords = ['식당', '카페', '커피', '치킨', '베이커리', '맥도날드', '스타벅스', '버거', '피자', '음식', '제과', '가든', '분식', '아메리카노', '라떼'];
    const transportKeywords = ['택시', 'ktx', '코레일', '주유소', '주차', '고속버스', '항공', '주유', '톨게이트', '통행료', '대리운전', '모범'];
    const shoppingKeywords = ['편의점', '마트', '다이소', 'cu', 'gs25', '이마트', '홈플러스', '롯데마트', '쇼핑', '백화점', '세븐일레븐', '올리브영'];

    if (foodKeywords.some(k => textForCategory.includes(k))) {
        result.category = '식비';
    } else if (transportKeywords.some(k => textForCategory.includes(k))) {
        result.category = '교통비';
    } else if (shoppingKeywords.some(k => textForCategory.includes(k))) {
        result.category = '비품/쇼핑';
    }

    // 2. 금액 추출 (가장 큰 금액을 최우선으로, 키워드 의존도 낮춤)
    // 텍스트 전체에서 등장하는 모든 숫자 중 가장 큰 금액(현실적인 범위 내)을 추출
    const findMaxAmount = (): number | null => {
        // 공백이 이미 제거된 상태이므로, 쉼표가 들어간 숫자 또는 연속된 숫자를 찾음
        const numRegex = /([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{3,})/g;
        const matches = [...spacelessText.matchAll(numRegex)];
        
        if (matches.length > 0) {
            const candidates = matches
                .map(m => parseInt(m[1].replace(/,/g, ''), 10))
                .filter(n => n > 100 && n < 10000000) // 100원 초과, 1천만원 미만의 합리적인 금액 필터
                .sort((a, b) => b - a);
                
            if (candidates.length > 0) {
                return candidates[0]; // 가장 큰 금액 반환
            }
        }
        return null;
    };

    // 혹시 모를 상황 대비(특정 키워드가 붙어있는 금액을 우선시 할 경우)
    const strongAmountKeywords = ['결제요금', '카드매출', '승인금액', '청구금액', '결제대상금액', '받은금액', '결제금액', '합계', '총결제', '총금액'];
    
    const extractAmountByKeywords = (keywords: string[]) => {
        const regex = new RegExp(`(?:${keywords.join('|')})[:：]?([\\d,]{3,})`, 'i');
        const match = spacelessText.match(regex);
        if (match) return parseInt(match[1].replace(/,/g, ''), 10);
        return null;
    };

    // 1순위: 전체에서 가장 큰 금액, 2순위: 키워드 기반
    let amount = findMaxAmount() || extractAmountByKeywords(strongAmountKeywords);
    
    if (amount) {
        result.amount = amount;
    }

    // 3. 날짜 추출 (한국어 YYYY년 MM월 DD일 등 지원 강화 및 공백 제거된 텍스트 활용)
    const koreanDateRegex = /(20\d{2}|19\d{2})년0?([1-9]|1[0-2])월0?([1-9]|[12]\d|3[01])일/i;
    const standardDateRegex = /(20\d{2}|19\d{2})[-/.]0?([1-9]|1[0-2])[-/.]0?([1-9]|[12]\d|3[01])/;
    const shortDateRegex = /(\d{2})[-/.]0?([1-9]|1[0-2])[-/.]0?([1-9]|[12]\d|3[01])/;
    const fourteenDigitRegex = /(20\d{2}|19\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{6}/; // 14자리 연속 숫자 (YYYYMMDDHHMMSS)
    const continuousDateRegex = /(20\d{2}|19\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/; // 8자리 연속 숫자 (YYYYMMDD)

    let year = 0, month = 0, day = 0;

    const fourteenMatch = spacelessText.match(fourteenDigitRegex);
    const krMatch = spacelessText.match(koreanDateRegex);
    const stdMatch = spacelessText.match(standardDateRegex);
    const shortMatch = spacelessText.match(shortDateRegex);
    const contMatch = spacelessText.match(continuousDateRegex);

    if (fourteenMatch) {
        year = parseInt(fourteenMatch[1], 10);
        month = parseInt(fourteenMatch[2], 10) - 1;
        day = parseInt(fourteenMatch[3], 10);
    } else if (krMatch) {
        year = parseInt(krMatch[1], 10);
        month = parseInt(krMatch[2], 10) - 1;
        day = parseInt(krMatch[3], 10);
    } else if (stdMatch) {
        year = parseInt(stdMatch[1], 10);
        month = parseInt(stdMatch[2], 10) - 1;
        day = parseInt(stdMatch[3], 10);
    } else if (contMatch) {
        year = parseInt(contMatch[1], 10);
        month = parseInt(contMatch[2], 10) - 1;
        day = parseInt(contMatch[3], 10);
    } else if (shortMatch) {
        year = 2000 + parseInt(shortMatch[1], 10);
        month = parseInt(shortMatch[2], 10) - 1;
        day = parseInt(shortMatch[3], 10);
    }

    if (year > 0) {
        // 시간 파싱
        const timeRegex = /(\d{1,2})[시:](\d{1,2})(?:[분:](\d{1,2})초?)?/;
        const timeMatch = spacelessText.match(timeRegex);
        if (timeMatch) {
            result.paidAt = new Date(year, month, day, parseInt(timeMatch[1], 10), parseInt(timeMatch[2], 10));
        } else {
            result.paidAt = new Date(year, month, day);
        }
    }

    // 4. 상호명 추출 (더 스마트해진 Fallback 포함)
    const merchantKeywords = ['매장명', '가맹점명', '상호명', '상호', '업소명', '지점명'];
    const merchantRegex = new RegExp(`(?:${merchantKeywords.join('|')})[:：]?([^\\n\\r\\t]+(?!대표|주소|전화|사업|고객|현금|신용))`, 'i');
    const merchantMatch = spacelessText.match(merchantRegex);

    if (merchantMatch && merchantMatch[1].length > 1) {
        result.merchantName = merchantMatch[1].replace(/[:：]/g, '').trim();
    } else {
        const validMerchantLine = lines.find(line => 
            (line.includes('점') || line.includes('식당') || line.includes('카페') || line.includes('(주)') || line.includes('주식회사')) &&
            !line.includes('대표') && !line.includes('주소') && !line.includes('전화') && !line.includes('사업자') && !line.includes('가맹점')
        );

        if (validMerchantLine) {
            result.merchantName = validMerchantLine.trim().substring(0, 30);
        } else {
            // 가장 상단에 있는 텍스트 중 사업자, 전화 등이 아닌 첫 줄을 상호명으로 추정 (첫 3줄 이내)
            const topLines = lines.slice(0, 3).filter(line => 
                line.length > 1 &&
                !line.includes('대표') && !line.includes('주소') && !line.includes('전화') && !line.includes('사업') &&
                !line.match(/\d{4}/) && !line.includes('영수증') && !line.includes('승인') && !line.includes('카드')
            );
            
            if (topLines.length > 0) {
                result.merchantName = topLines[0].trim();
            } else {            
                const candidate = lines.find(line => 
                    line.length > 2 && line.length < 25 &&
                    !line.match(/\d{4}/) && !line.includes('영수증') && !line.includes('카드') && !line.includes('승인')
                );
                result.merchantName = candidate ? candidate.trim() : '알 수 없는 상호명';
            }
        }
    }

    return result;
}
