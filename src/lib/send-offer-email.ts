/**
 * Sdílené odeslání nabídky — jediný vstup pro poptávky i sekci Nabídky.
 */
export {
  sendInquiryOfferEmail as sendOfferEmail,
  saveInquiryOfferDraft,
  type SendInquiryOfferEmailParams as SendOfferEmailParams,
  type SendInquiryOfferEmailResult as SendOfferEmailResult,
} from "@/lib/inquiry-offer-send-admin";
