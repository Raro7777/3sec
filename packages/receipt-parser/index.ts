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

    // 1. 카테고리(Category) 자동 추론
    const textForCategory = fullTextStr.replace(/\s/g, '').toLowerCase();
    
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

    // 2. 금액 추출 (고도화: 특정 강력한 키워드 우선)
    const strongAmountKeywords = ['승\\s*인\\s*금\\s*액', '청\\s*구\\s*금\\s*액', '결\\s*제\\s*대\\s*상\\s*금\\s*액', '받\\s*은\\s*금\\s*액', '결\\s*제\\s*금\\s*액'];
    const genericAmountKeywords = ['합\\s*계', '총\\s*금\\s*액', '금\\s*액', 'total', 'amount'];
    
    const extractAmount = (keywords: string[]) => {
        const regex = new RegExp(`(?:${keywords.join('|')})\\s*[:：]?\\s*([\\d,]{3,})`, 'i');
        const match = fullTextStr.match(regex);
        if (match) return parseInt(match[1].replace(/,/g, ''), 10);
        return null;
    };

    let amount = extractAmount(strongAmountKeywords) || extractAmount(genericAmountKeywords);
    
    if (amount) {
        result.amount = amount;
    } else {
        // Fallback: 가장 큰 금액 (원, \ 등으로 끝나는/시작하는 숫자 우대)
        const wonRegex = /(?:[\\]|원)?\s*([\d,]{3,})\s*(?:원)?/g;
        const matches = [...fullTextStr.matchAll(wonRegex)];
        if (matches.length > 0) {
            const candidates = matches
                .map(m => parseInt(m[1].replace(/,/g, ''), 10))
                .filter(n => n > 100 && n < 10000000 && n % 10 === 0)
                .sort((a, b) => b - a);
            if (candidates.length > 0) {
                result.amount = candidates.find(c => c < 1000000) || candidates[0];
            }
        }
    }

    // 3. 날짜 추출 (한국어 YYYY년 MM월 DD일 등 지원 강화)
    const koreanDateRegex = /(20\d{2}|2[0-5]|19\d{2})\s*년\s*0?([1-9]|1[0-2])\s*월\s*0?([1-9]|[12]\d|3[01])\s*일/i;
    const standardDateRegex = /(20\d{2}|19\d{2})[-/.]0?([1-9]|1[0-2])[-/.]0?([1-9]|[12]\d|3[01])/;
    const shortDateRegex = /(\d{2})[-/.]0?([1-9]|1[0-2])[-/.]0?([1-9]|[12]\d|3[01])/;

    let year = 0, month = 0, day = 0;

    const krMatch = fullTextStr.match(koreanDateRegex);
    if (krMatch) {
        year = krMatch[1].length === 2 ? 2000 + parseInt(krMatch[1], 10) : parseInt(krMatch[1], 10);
        month = parseInt(krMatch[2], 10) - 1;
        day = parseInt(krMatch[3], 10);
    } else {
        const stdMatch = fullTextStr.match(standardDateRegex);
        if (stdMatch) {
            year = parseInt(stdMatch[1], 10);
            month = parseInt(stdMatch[2], 10) - 1;
            day = parseInt(stdMatch[3], 10);
        } else {
            const shMatch = fullTextStr.match(shortDateRegex);
            if (shMatch) {
                year = 2000 + parseInt(shMatch[1], 10);
                month = parseInt(shMatch[2], 10) - 1;
                day = parseInt(shMatch[3], 10);
            }
        }
    }

    if (year > 0) {
        // 시간 파싱
        const timeRegex = /(\d{1,2})[시:]\s*(\d{1,2})(?:[분:]\s*(\d{1,2})초?)?/;
        const timeMatch = fullTextStr.match(timeRegex);
        if (timeMatch) {
            result.paidAt = new Date(year, month, day, parseInt(timeMatch[1], 10), parseInt(timeMatch[2], 10));
        } else {
            result.paidAt = new Date(year, month, day);
        }
    }

    // 4. 상호명 추출 (더 스마트해진 Fallback 포함)
    const merchantKeywords = ['매\\s*장\\s*명', '가\\s*맹\\s*점\\s*명', '상\\s*호\\s*명', '상\\s*호', '업\\s*소\\s*명', '지\\s*점\\s*명'];
    const merchantRegex = new RegExp(`(?:${merchantKeywords.join('|')})\\s*[:：]?\\s*([^\\n\\r\\t\\s]+(?!대표|주소|전화|사업|고객|현금|신용))`, 'i');
    const merchantMatch = fullTextStr.match(merchantRegex);

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
            const candidate = lines.find(line => 
                line.length > 2 && line.length < 25 &&
                !line.match(/\d{4}/) && !line.includes('영수증') && !line.includes('카드') && !line.includes('승인')
            );
            result.merchantName = candidate ? candidate.trim() : '알 수 없는 상호명';
        }
    }

    return result;
}
