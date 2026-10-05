export type EvotorPaymentEvidence = {
  receiptClosed: true;
  paymentType: "ELECTRON";
  total: number;
  paymentIdentifier: string;
  paymentPerformerPackageName: string;
  paymentPerformerComponentName: string;
  paymentSystemId: string;
};

export function hasValidEvotorPaymentEvidence(
  evidence: EvotorPaymentEvidence | null | undefined,
  expectedAmount: number
): evidence is EvotorPaymentEvidence {
  return evidence?.receiptClosed === true
    && evidence.paymentType === "ELECTRON"
    && Number.isFinite(evidence.total)
    && evidence.total === expectedAmount
    && Boolean(evidence.paymentIdentifier.trim())
    && Boolean(evidence.paymentPerformerPackageName.trim())
    && Boolean(evidence.paymentPerformerComponentName.trim())
    && Boolean(evidence.paymentSystemId.trim());
}
