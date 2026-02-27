import axios from 'axios';
import FormData from 'form-data';

export interface OcrResult {
  merchantName?: string;
  amount?: number;
  paidAt?: Date;
  rawText: string;
  fullJson: any;
}

export interface OcrProvider {
  processImage(imageBuffer: Buffer, fileName: string): Promise<OcrResult>;
}

export class NaverOcrProvider implements OcrProvider {
  private readonly invokeUrl: string;
  private readonly secretKey: string;

  constructor(invokeUrl: string, secretKey: string) {
    this.invokeUrl = invokeUrl;
    this.secretKey = secretKey;
  }

  async processImage(imageBuffer: Buffer, fileName: string): Promise<OcrResult> {
    const formData = new FormData();
    const message = {
      version: 'V2',
      requestId: `req-${Date.now()}`,
      timestamp: Date.now(),
      images: [
        {
          format: fileName.split('.').pop() || 'jpg',
          name: 'receipt',
        },
      ],
    };

    formData.append('message', JSON.stringify(message));
    formData.append('file', imageBuffer, { filename: fileName });

    try {
      const response = await axios.post(this.invokeUrl, formData, {
        headers: {
          ...formData.getHeaders(),
          'X-OCR-SECRET': this.secretKey,
        },
      });

      const fullJson = response.data;
      const rawText = this.extractRawText(fullJson);

      // merchantName, amount, paidAt은 receipt-parser에서 처리하도록 rawText와 fullJson만 반환
      return {
        rawText,
        fullJson,
      };
    } catch (error) {
      console.error('Naver OCR API error:', error);
      throw new Error('Failed to process image with Naver OCR');
    }
  }

  private extractRawText(fullJson: any): string {
    if (!fullJson.images || !fullJson.images[0].fields) {
      return '';
    }
    return fullJson.images[0].fields
      .map((field: any) => field.inferText)
      .join(' ');
  }
}
