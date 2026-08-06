import { loadSnapshot } from "@/lib/data";
import { toTRYOrZero } from "@/lib/fx";
import { LoansClient, type LoanView } from "./loans-client";

export const metadata = { title: "Krediler" };
export const dynamic = "force-dynamic";

export default async function LoansPage() {
  const snap = await loadSnapshot();

  const loans: LoanView[] = snap.loans
    .map((loan) => {
      const payments = snap.loanPayments
        .filter((p) => p.loanId === loan.id)
        .sort((a, b) => a.seq - b.seq);
      const unpaid = payments.filter((p) => !p.isPaid);

      return {
        id: loan.id,
        name: loan.name,
        type: loan.type,
        institutionId: loan.institutionId,
        institutionName: loan.institutionId
          ? (snap.institutionById.get(loan.institutionId)?.name ?? null)
          : null,
        principalMinor: loan.principalMinor,
        currency: loan.currency,
        annualRateBps: loan.annualRateBps,
        installmentCount: loan.installmentCount,
        monthlyPaymentMinor: loan.monthlyPaymentMinor,
        firstPaymentDate: loan.firstPaymentDate,
        paymentAccountId: loan.paymentAccountId,
        status: loan.status,
        notes: loan.notes,
        paidCount: payments.filter((p) => p.isPaid).length,
        remainingMinor: unpaid.reduce((s, p) => s + p.amountMinor, 0),
        remainingPrincipalMinor: unpaid.reduce((s, p) => s + p.principalMinor, 0),
        totalInterestMinor: payments.reduce((s, p) => s + p.interestMinor, 0),
        nextDueDate: unpaid[0]?.dueDate ?? null,
        payments: payments.map((p) => ({
          id: p.id,
          seq: p.seq,
          dueDate: p.dueDate,
          amountMinor: p.amountMinor,
          principalMinor: p.principalMinor,
          interestMinor: p.interestMinor,
          isPaid: p.isPaid,
        })),
      };
    })
    .sort(
      (a, b) =>
        Number(b.status === "aktif") - Number(a.status === "aktif") ||
        b.remainingMinor - a.remainingMinor,
    );

  const totals = loans
    .filter((l) => l.status === "aktif")
    .reduce(
      (acc, loan) => {
        acc.remainingMinor += toTRYOrZero(loan.remainingMinor, loan.currency, snap.rates);
        acc.monthlyMinor += toTRYOrZero(
          loan.monthlyPaymentMinor,
          loan.currency,
          snap.rates,
        );
        return acc;
      },
      { remainingMinor: 0, monthlyMinor: 0 },
    );

  return (
    <LoansClient
      loans={loans}
      institutions={snap.institutions
        .filter((i) => i.isActive)
        .map((i) => ({ value: i.id, label: i.name }))}
      accounts={snap.accounts
        .filter((a) => a.isActive)
        .map((a) => ({ value: a.id, label: a.name }))}
      totals={totals}
    />
  );
}
