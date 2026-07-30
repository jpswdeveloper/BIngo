import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as https from 'https';

export interface TelebirrParsedReceipt {
  transactionId: string;
  payerName?: string | null;
  creditedPartyName?: string | null;
  creditedPartyNumber?: string | null;
  amount: number | null;
  paymentDate?: string | null;
  rawUrl?: string;
  isVerifiedViaWeb: boolean;
}

@Injectable()
export class TelebirrScraperService {
  private readonly logger = new Logger(TelebirrScraperService.name);

  /**
   * Extract Transaction ID and Receipt URL from user SMS text
   */
  extractReceiptUrl(smsText: string): {
    transactionId: string | null;
    url: string | null;
  } {
    const urlMatch = smsText.match(
      /(https:\/\/transactioninfo\.ethiotelecom\.et\/receipt\/([A-Z0-9]+))/i,
    );
    if (urlMatch) {
      return { url: urlMatch[1], transactionId: urlMatch[2].toUpperCase() };
    }

    const txnMatch = smsText.match(
      /(?:transaction (?:number|no|id) is|receipt\/)\s*([A-Z0-9]{10,12})/i,
    );
    if (txnMatch) {
      const txnId = txnMatch[1].toUpperCase();
      return {
        transactionId: txnId,
        url: `https://transactioninfo.ethiotelecom.et/receipt/${txnId}`,
      };
    }

    return { transactionId: null, url: null };
  }

  /**
   * Fallback SMS Parser when Telebirr web endpoint is down or blocking foreign IPs
   */
  parseSmsDirectly(smsText: string): TelebirrParsedReceipt | null {
    const { transactionId } = this.extractReceiptUrl(smsText);
    if (!transactionId) return null;

    // Regex to extract transferred amount (e.g. "transferred ETB 20.00")
    const amountMatch =
      smsText.match(
        /(?:transferred|paid)\s+(?:ETB|ብር)?\s*([\d,]+(?:\.\d{1,2})?)/i,
      ) || smsText.match(/ETB\s*([\d,]+(?:\.\d{1,2})?)/i);

    // Regex to extract receiver phone/account number if present, including masked numbers
    const phoneMatch =
      smsText.match(
        /\((\+?251\d{9}|09\d{8}|07\d{8}|251\d{9}|[0-9*]{8,14})\)/,
      ) ||
      smsText.match(
        /to\s+([A-Z\s]+)\s*\((\+?251\d{9}|09\d{8}|07\d{8}|251\d{9}|[0-9*]{8,14})\)/i,
      );

    const amount = amountMatch
      ? parseFloat(amountMatch[1].replace(/,/g, ''))
      : null;
    const creditedPartyNumber = phoneMatch ? phoneMatch[1] : null;

    if (!amount) return null;

    return {
      transactionId,
      amount,
      creditedPartyNumber,
      isVerifiedViaWeb: false,
    };
  }

  /**
   * Main Fetcher: Tries Direct JSON API -> HTML Scraping -> SMS Fallback
   */
  async scrapeReceiptPage(smsText: string): Promise<{
    success: boolean;
    data?: TelebirrParsedReceipt;
    error?: string;
  }> {
    let { url, transactionId } = this.extractReceiptUrl(smsText);

    if (!transactionId) {
      return { success: false, error: 'invalid_sms_format' };
    }

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json, text/html, */*',
    };

    //Try Web HTML Scraping
    if (url) {
      try {
        const response = await axios.get(url, {
          httpsAgent,
          headers,
          timeout: 6000,
        });
        const $ = cheerio.load(response.data);

        let payerName: string | null = null;
        let creditedPartyName: string | null = null;
        let creditedPartyNumber: string | null = null;
        let amount: number | null = null;
        let paymentDate: string | null = null;

        const normalizeLabel = (label: string) =>
          label.replace(/\s+/g, ' ').trim().toLowerCase();

        const isLabelLike = (text: string): boolean =>
          /payment date|የክፍያ ቀን|invoice no|total amount paid|total paid amount|settled amount|የተከፈለው መጠን|payer name|credited party name|credited party account no|receiver account/.test(
            normalizeLabel(text),
          );

        const extractNumber = (raw: string): string | null => {
          const match = raw.match(
            /(\+?251\d{9}|09\d{8}|07\d{8}|251\d{9}|[0-9*]{8,14})/,
          );
          return match ? match[1] : null;
        };

        const extractAmount = (raw: string): number | null => {
          const match = raw.match(/(\d+(?:\.\d{1,2})?)/);
          return match ? parseFloat(match[1]) : null;
        };

        const extractDate = (raw: string): string | null => {
          const match = raw.match(/\b\d{2}[\/\-]\d{2}[\/\-]\d{4}\s+\d{2}:\d{2}:\d{2}\b/);
          if (match) return match[0];
          const alt = raw.match(/\b\d{2}[\/\-]\d{2}[\/\-]\d{4}\b/);
          return alt ? alt[0] : null;
        };

        const rows = $('table tr').toArray();
        rows.forEach((row, index) => {
          const cells = $(row)
            .find('th, td')
            .toArray()
            .map((cell) => $(cell).text().trim())
            .filter(Boolean);

          if (cells.length === 2) {
            const label = normalizeLabel(cells[0]);
            const value = cells[1];

            if (/payer name|የከፋይ ስም/.test(label)) {
              payerName = value;
            }
            if (/credited party name|የገንዘብ ተቀባይ ስም/.test(label)) {
              creditedPartyName = value;
            }
            if (
              /credited party account no|receiver account|የገንዘብ ተቀባይ ቴሌብር|የገንዘብ ተቀባይ ስልክ/.test(
                label,
              )
            ) {
              creditedPartyNumber = extractNumber(value);
            }
            if (
              /total amount paid|total paid amount|settled amount|የተከፈለው መጠን/.test(
                label,
              )
            ) {
              amount = extractAmount(value);
            }
            if (/payment date|የክፍያ ቀን/.test(label)) {
              const candidate = value.trim();
              if (!isLabelLike(candidate)) {
                paymentDate = candidate;
              }
            }
          }

          const headerLabels = cells.map((cell) => normalizeLabel(cell));
          const nextRow = rows[index + 1]
            ? $(rows[index + 1])
                .find('th, td')
                .toArray()
                .map((cell) => $(cell).text().trim())
            : [];

          if (
            headerLabels.some((text) => /invoice no/.test(text)) &&
            nextRow.length
          ) {
            const invoiceIndex = headerLabels.findIndex((text) =>
              /invoice no/.test(text),
            );
            if (invoiceIndex !== -1 && nextRow[invoiceIndex]) {
              // If transactionId wasn't parsed from URL, use it from the invoice table
              if (!transactionId) {
                transactionId = nextRow[invoiceIndex].trim();
              }
            }
          }

          const amountHeaderIndex = headerLabels.findIndex((text) =>
            /total amount paid|total paid amount|settled amount|የተከፈለው መጠን/.test(
              text,
            ),
          );
          if (amountHeaderIndex !== -1 && nextRow[amountHeaderIndex]) {
            amount = extractAmount(nextRow[amountHeaderIndex]);
          }

          const paymentDateIndex = headerLabels.findIndex((text) =>
            /payment date|የክፍያ ቀን/.test(text),
          );
          if (paymentDateIndex !== -1 && nextRow[paymentDateIndex]) {
            const candidate = nextRow[paymentDateIndex].trim();
            if (!isLabelLike(candidate)) {
              paymentDate = candidate;
            }
          }
        });

        $('tr, div, p').each((_, element) => {
          const text = $(element).text().trim();

          if (text.includes('Payer Name') || text.includes('የከፋይ ስም')) {
            payerName = $(element)
              .find('td:last-child, span:last-child')
              .text()
              .trim();
          }
          if (
            text.includes('Credited Party Name') ||
            text.includes('የገንዘብ ተቀባይ ስም')
          ) {
            creditedPartyName = $(element)
              .find('td:last-child, span:last-child')
              .text()
              .trim();
          }
          if (
            text.includes('Credited party account no') ||
            text.includes('Receiver Account') ||
            text.includes('የገንዘብ ተቀባይ ቴሌብር ቁ./') ||
            text.includes('የገንዘብ ተቀባይ ቴሌብር ቁ') ||
            text.includes('የገንዘብ ተቀባይ ቴሌብር ቁ.') ||
            text.includes('የገንዘብ ተቀባይ ስልክ')
          ) {
            const rawNum = $(element)
              .find('td:last-child, span:last-child')
              .text()
              .trim();
            const normalized = extractNumber(rawNum);
            if (normalized) creditedPartyNumber = normalized;
          }
          if (
            text.includes('Total Amount Paid') ||
            text.includes('Total Paid Amount') ||
            text.includes('Settled Amount') ||
            text.includes('የተከፈለው መጠን')
          ) {
            const rawAmount = $(element)
              .find('td:last-child, span:last-child')
              .text()
              .trim();
            const parsed = extractAmount(rawAmount);
            if (parsed) amount = parsed;
          }
          if (text.includes('Payment date') || text.includes('የክፍያ ቀን')) {
            const rawDate = $(element)
              .find('td:last-child, span:last-child')
              .text()
              .trim();
            if (rawDate) paymentDate = rawDate;
          }
        });

        if (amount) {
          if (paymentDate && isLabelLike(paymentDate)) {
            paymentDate = null;
          }

          if (!paymentDate) {
            const textBody = $('body').text();
            paymentDate = extractDate(textBody) || paymentDate;
          }

          return {
            success: true,
            data: {
              transactionId,
              payerName,
              creditedPartyName,
              creditedPartyNumber,
              amount,
              paymentDate,
              rawUrl: url,
              isVerifiedViaWeb: true,
            },
          };
        }
      } catch (e) {
        this.logger.warn(
          `Telebirr HTML fetch failed or blocked for ${transactionId}`,
        );
      }
    }

    // Method 3: Fallback to Direct SMS Regex Parsing if Web is blocked
    const fallbackData = this.parseSmsDirectly(smsText);
    if (fallbackData) {
      this.logger.log(
        `Parsed receipt ${transactionId} via SMS fallback regex.`,
      );
      return {
        success: true,
        data: fallbackData,
      };
    }

    return { success: false, error: 'receipt_unreachable' };
  }
}
