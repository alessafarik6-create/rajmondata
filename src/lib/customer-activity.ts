import { addDoc, collection, serverTimestamp, type Firestore } from "firebase/firestore";

export type CustomerActivityType =
  | "customer_product_selected"
  | "customer_product_selection_updated"
  | "customer_annotation_created"
  | "customer_annotation_updated"
  | "customer_note_added"
  | "customer_chat_message"
  | "customer_document_comment"
  | "customer_pdf_annotation"
  | "customer_image_annotation";

export type CustomerActivityPayload = {
  organizationId: string;
  jobId?: string | null;
  customerId?: string | null;
  customerUserId: string;
  type: CustomerActivityType;
  title: string;
  message: string;
  createdBy: string;
  createdByRole: "customer";
  isRead: boolean;
  targetType: "job" | "chat" | "annotation" | "catalog-selection";
  targetId: string;
  targetLink?: string;
  priority?: "low" | "normal" | "high";
};

export async function createCustomerActivity(
  firestore: Firestore,
  payload: CustomerActivityPayload
): Promise<void> {
  const data = {
    ...payload,
    createdAt: serverTimestamp(),
    readAt: null,
    readBy: null,
    priority: payload.priority ?? "normal",
  };
  if (process.env.NODE_ENV === "development") {
    console.log("customer activity created", data);
  }
  await addDoc(
    collection(firestore, "companies", payload.organizationId, "customer_activities"),
    data
  );
}

