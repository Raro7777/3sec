export interface ParsedReceipt {
    merchantName?: string;
    amount?: number;
    paidAt?: Date;
}

export function parseReceiptText(text: string): ParsedReceipt {
    const result: ParsedReceipt = {};

    // 1. 합계 금액 추출 (다양한 공백 및 키워드 대응)
    // "합 계", "합계", "결제금액", "TOTAL AMOUNT" 등 대응
    const amountKeywords = ['합\\s*계', '결제금액', '금액', '총\\s*금액', 'TOTAL', 'AMOUNT'];
    const amountRegex = new RegExp(`(?:${amountKeywords.join('|')})\\s*[:]?\\s*([\\d,]{3,})`, 'i');

    const amountMatch = text.match(amountRegex);
    if (amountMatch) {
        result.amount = parseInt(amountMatch[1].replace(/,/g, ''), 10);
    } else {
        // 키워드 매칭 실패 시 가장 큰 숫자 후보군 중 금액일 확률이 높은 것 선택
        // 가맹번호(8자리 이상) 등은 제외하고 보통 10만원 이하가 많으므로 필터링 보강
        const numbers = text.match(/[\d,]{4,}/g);
        if (numbers) {
            const candidates = numbers
                .map(n => parseInt(n.replace(/,/g, ''), 10))
                .filter(n => n > 100 && n < 10000000) // 100원 초과 1000만원 미만 (가맹번호 등 제외)
                .filter(n => n % 10 === 0) // 보통 0으로 끝남
                .sort((a, b) => b - a);

            if (candidates.length > 0) {
                // 상향 기준: 100만 이하의 가장 큰 숫자를 우선 고려
                const reasonableAmount = candidates.find(c => c < 1000000);
                result.amount = reasonableAmount || candidates[0];
            }
        }
    }

    // 2. 날짜 추출 (전화번호와 혼동 방지를 위해 연도 패턴 강화)
    // 20xx 또는 19xx로 시작하는지 우선 확인
    const dateRegex = /(20\d{2}|19\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/;
    const dateMatch = text.match(dateRegex);
    if (dateMatch) {
        const year = parseInt(dateMatch[1], 10);
        const month = parseInt(dateMatch[2], 10) - 1;
        const day = parseInt(dateMatch[3], 10);

        if (month >= 0 && month < 12 && day > 0 && day <= 31) {
            // 시간 추출 시도 (HH:mm:ss 또는 HH:mm)
            const timeRegex = /(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/;
            const timeMatch = text.match(timeRegex);
            if (timeMatch) {
                result.paidAt = new Date(year, month, day, parseInt(timeMatch[1], 10), parseInt(timeMatch[2], 10));
            } else {
                result.paidAt = new Date(year, month, day);
            }
        }
    } else {
        // YY/MM/DD 형식 시도
        const shortDateRegex = /(\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/;
        const shortMatch = text.match(shortDateRegex);
        if (shortMatch) {
            const year = 2000 + parseInt(shortMatch[1], 10);
            const month = parseInt(shortMatch[2], 10) - 1;
            const day = parseInt(shortMatch[3], 10);
            if (month >= 0 && month < 12 && day > 0 && day <= 31) {
                result.paidAt = new Date(year, month, day);
            }
        }
    }

    // 3. 상호명 추출 (키워드 매칭 및 가상 광고 문구 제외)
    const lines = text.split(/\s{2,}|[\n\r]/);

    // "가맹점명", "상호명", "상호" 키워드 다음에 오는 텍스트 찾기 (글자 사이 공백 무시)
    const merchantKeywords = ['가\\s*맹\\s*점\\s*명', '상\\s*호\\s*명', '상\\s*호'];
    const merchantRegex = new RegExp(`(?:${merchantKeywords.join('|')})\\s*[:：]?\\s*([^\\n\\r\\t\\s]+)`, 'i');
    const merchantMatch = text.match(merchantRegex);

    if (merchantMatch && merchantMatch[1].length > 1) {
        result.merchantName = merchantMatch[1].replace(/[:：]/g, '').trim();
    } else {
        // 키워드 매칭 실패 시 (주)가 포함되거나 적절한 길이의 첫 줄 선택
        const merchantLine = lines.find(line =>
            (line.includes('(주)') || line.includes('주식회사')) &&
            !line.includes('가맹점주소') // 안내 문구 제외
        );

        if (merchantLine) {
            result.merchantName = merchantLine.trim().substring(0, 30);
        } else {
            // 의미 있는 실제 상호명을 찾기 위해 앞쪽 라인들 탐색
            const candidate = lines.find(line =>
                line.length > 2 &&
                !line.includes('가맹점명') &&
                !line.includes('www.') &&
                !line.includes('안내')
            );
            result.merchantName = candidate ? candidate.trim().substring(0, 25) : '알 수 없는 상점';
        }
    }

    return result;
}
