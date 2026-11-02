import {
  buildInquiryOfferInlineGalleryHtml,
  buildInlineImageCid,
  listInlineImageRefs,
} from "@/lib/inquiry-offer-inline-images";
import {
  isInquiryOfferInlineInEmail,
  shouldAttachAsFile,
  type InquiryOfferAttachmentRef,
} from "@/lib/inquiry-offer-attachments";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function imgRef(partial: Partial<InquiryOfferAttachmentRef> & { id: string }): InquiryOfferAttachmentRef {
  return {
    source: "upload",
    filename: "foto.jpg",
    contentType: "image/jpeg",
    inlineInEmail: true,
    ...partial,
  };
}

const refs = [imgRef({ id: "b", inlineOrder: 2 }), imgRef({ id: "a", inlineOrder: 1 })];
assert(
  listInlineImageRefs(refs)
    .map((r) => r.id)
    .join(",") === "a,b",
  "inline sort by order"
);

const pdf: InquiryOfferAttachmentRef = {
  id: "pdf",
  source: "library",
  filename: "nabidka.pdf",
  contentType: "application/pdf",
};
const inline = imgRef({ id: "pic" });
assert(isInquiryOfferInlineInEmail(inline), "image inline default");
assert(shouldAttachAsFile(pdf), "pdf as file");
assert(!shouldAttachAsFile(inline), "inline only no file");
assert(shouldAttachAsFile(imgRef({ id: "pic2", inlineInEmail: false })), "image attachment only");
assert(shouldAttachAsFile(imgRef({ id: "x", alsoAsAttachment: true })), "also as attachment");

const html = buildInquiryOfferInlineGalleryHtml([
  { src: "cid:nabidka-foto-1", alt: "Pergola", caption: "Ukázka" },
]);
assert(html.includes('src="cid:nabidka-foto-1"'), "cid in html");
assert(html.includes("max-width:600px"), "responsive width");
assert(html.includes("Ukázka"), "caption");

assert(/^nabidka-foto-1-/.test(buildInlineImageCid(imgRef({ id: "att-abc" }), 0)), "cid prefix");

console.log("inquiry-offer-inline-images.test.ts OK");
