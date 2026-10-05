export type EvotorPaymentEvidence = {
  receiptClosed: true;
  paymentType: "ELECTRON";
  total: number;
  paymentIdentifier: string;
  paymentSystemId: string;
};

export function hasValidEvotorPaymentEvidence(
  evidence: EvotorPaymentEvidence | null | undefined,
  expectedAmount: number,
  expectedPaymentSystemId: string | null | undefined
): evidence is EvotorPaymentEvidence {
  const expectedSystemId = expectedPaymentSystemId?.trim();
  const paymentIdentifier = typeof evidence?.paymentIdentifier === "string"
    ? evidence.paymentIdentifier.trim()
    : "";
  const paymentSystemId = typeof evidence?.paymentSystemId === "string"
    ? evidence.paymentSystemId.trim()
    : "";
  return evidence?.receiptClosed === true
    && evidence.paymentType === "ELECTRON"
    && Number.isFinite(evidence.total)
    && evidence.total === expectedAmount
    && Boolean(paymentIdentifier)
    && Boolean(expectedSystemId)
    && paymentSystemId === expectedSystemId;
}

export function hasValidEvotorFiscalIdentity(
  fiscal: {
    storageNumber: string;
    documentNumber: string;
    sign: string;
    fiscalizedAt: string;
    total?: number;
    documentType: "SELL";
  } | null | undefined,
  expectedAmount: number
) {
  const hasText = (value: unknown) => typeof value === "string" && Boolean(value.trim());
  return hasText(fiscal?.storageNumber)
    && hasText(fiscal?.documentNumber)
    && hasText(fiscal?.sign)
    && typeof fiscal?.fiscalizedAt === "string"
    && Number.isFinite(Date.parse(fiscal.fiscalizedAt))
    && (fiscal.total === undefined || fiscal.total === expectedAmount)
    && fiscal.documentType === "SELL";
}
