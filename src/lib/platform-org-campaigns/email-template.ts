import { buildNotificationHtml } from "@/lib/email-notifications/resend-send";

export function buildOrgCampaignEmailHtml(input: {
  organizationName: string;
  title: string;
  shortDescription: string;
  imageUrl?: string | null;
  campaignUrl: string;
  customHtml?: string | null;
}): string {
  if (input.customHtml?.trim()) {
    return input.customHtml.trim();
  }
  const lines = [
    "Dobrý den,",
    `v systému RAJMONDATA jsme pro vaši organizaci ${input.organizationName} připravili novou zprávu.`,
    "",
    input.title,
    input.shortDescription,
  ];
  if (input.imageUrl) {
    lines.push(`<img src="${input.imageUrl.replace(/"/g, "")}" alt="" style="max-width:100%;height:auto;border-radius:8px;margin:12px 0" />`);
  }
  lines.push("Více informací naleznete ve svém účtu RAJMONDATA.");
  return buildNotificationHtml({
    moduleLabel: "RAJMONDATA",
    title: input.title,
    companyName: input.organizationName,
    lines,
    actionUrl: input.campaignUrl,
  });
}
