export type OrganizationAiEntityRef = {
  type: string;
  id: string;
  label: string;
  href: string;
};

export function organizationAiEntityHref(type: string, id: string): string | null {
  const t = type.toLowerCase();
  const safe = encodeURIComponent(id);
  switch (t) {
    case "job":
      return `/portal/jobs/${safe}`;
    case "customer":
      return `/portal/customers/${safe}`;
    case "invoice":
      return `/portal/invoices?highlight=${safe}`;
    case "document":
      return `/portal/documents?doc=${safe}`;
    case "email":
    case "email_message":
      return `/portal/email?messageId=${safe}`;
    case "lead":
    case "inquiry":
      return `/portal/leads?lead=${safe}`;
    case "offer":
      return `/portal/offers?offer=${safe}`;
    case "employee":
      return `/portal/employees/${safe}`;
    case "camera":
      return `/portal/cameras?camera=${safe}`;
    case "meeting":
    case "schedule":
      return `/portal/schedule?event=${safe}`;
    case "production":
      return `/portal/vyroba?record=${safe}`;
    case "vehicle":
    case "fleet":
      return `/portal/fleet?vehicle=${safe}`;
    case "task":
      return `/portal/jobs?task=${safe}`;
    default:
      return null;
  }
}

export function organizationAiEntityRef(
  type: string,
  id: string,
  label: string
): OrganizationAiEntityRef | null {
  const href = organizationAiEntityHref(type, id);
  if (!href) return null;
  return { type, id, label: label.slice(0, 200), href };
}
