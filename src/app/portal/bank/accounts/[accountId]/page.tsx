"use client";

import { use } from "react";
import { BankAccountDetailPage } from "@/components/bank/bank-account-detail-page";

export default function PortalBankAccountPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = use(params);
  return <BankAccountDetailPage accountId={accountId} />;
}
