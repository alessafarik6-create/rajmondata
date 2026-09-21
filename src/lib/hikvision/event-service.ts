/** Fáze 6 — long-running listener na /ISAPI/Event/notification/alertStream (connector/worker). */
export class HikvisionEventService {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_organizationId: string) {}

  startAlertStream(): void {
    /* běží v RAJMONDATA Local Connector, ne na Vercel */
  }
}
