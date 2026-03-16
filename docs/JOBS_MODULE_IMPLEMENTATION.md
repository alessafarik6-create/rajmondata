# Jobs Module – Implementation Summary and Next Steps

## 1. Form input styling (DONE)

**Problem:** Inputs in the "Create new job" modal had a black background because the dialog is portaled to `document.body` and did not inherit the portal light theme.

**Solution:**
- **`src/app/globals.css`:** Added a `[data-portal-dialog]` block that applies the same light theme variables as `[data-portal-content]` (background, foreground, border, input, focus, disabled). Portaled dialogs that add `data-portal-dialog` to their content now get light inputs, labels, and focus states.
- **`src/app/portal/jobs/page.tsx`:** Set `data-portal-dialog` on `DialogContent` and removed `className="bg-background"` from all inputs, textarea, and select trigger. Set `SelectContent` to `bg-white border-slate-200 text-slate-900`. Added placeholders and `min={0}` for budget.

**Result:** All job creation form fields (text, textarea, select, number, date) use a white background, readable text, and clear focus/disabled states in the modal.

---

## 2. Job template system (DONE)

### Database structure (Firestore)

- **`companies/{companyId}/jobTemplates/{templateId}`**
  - `name: string`
  - `productType: string`
  - `description?: string`
  - `sections: Array<{ id, name, order, fields: Array<{ id, type, label, required?, placeholder?, options? }> }>`
  - `createdAt`, `updatedAt` (timestamps)

- **`companies/{companyId}/jobs/{jobId}`** (extended)
  - Existing fields unchanged.
  - `templateId?: string` – reference to job template.
  - `templateValues?: Record<string, string | number | boolean | null>` – keys like `{sectionId}_{fieldId}`.

### Field types

- `short_text`, `long_text`, `number`, `measurement`, `checkbox`, `select`, `date`, `notes`.

### New/updated files

- **`src/lib/job-templates.ts`** – Types and constants for templates and field types.
- **`src/components/jobs/job-template-field-editor.tsx`** – Admin UI to add/edit/remove fields (type, label, required, options for select).
- **`src/components/jobs/job-template-form-fields.tsx`** – Renders the dynamic form for a selected template (used when creating/editing a job).
- **`src/app/portal/jobs/templates/page.tsx`** – Admin page: list templates, create new template (sections + fields), link “Použít při vytváření zakázky” with `?templateId=`.
- **`src/app/portal/jobs/page.tsx`** – Loads templates; optional “Šablona” select in create dialog; when a template is selected, renders `JobTemplateFormFields`; saves `templateId` and `templateValues` with the job; link “Šablony” to `/portal/jobs/templates`.
- **`src/app/portal/jobs/[jobId]/page.tsx`** – Loads template when `job.templateId` is set; shows “Data šablony” card with sections and field values from `job.templateValues`.

### UI flow

1. Admin goes to **Zakázky → Šablony**, creates a template (name, product type, sections, fields).
2. When creating a job, user can choose a template; the form then shows the template fields below the base fields.
3. On job detail, if the job has a template, its data is displayed in a “Data šablony” card.

---

## 3. Image annotation with dimensions (DESIGN – to implement)

### Goals

- Upload one or more images per job.
- Draw dimension lines/annotations on each image.
- Store numeric measurement and optional text note per annotation.
- Annotations editable later; structure scalable.

### Suggested data model

- **`companies/{companyId}/jobs/{jobId}/attachments`** (subcollection or array on job)
  - `type: 'image'`
  - `storagePath: string` (e.g. Firebase Storage path)
  - `url: string` (download URL)
  - `filename: string`
  - `uploadedAt`, `uploadedBy`
  - `annotations: Array<{ id, kind: 'dimension'|'note', points: [{x,y}, ...], value?: number, unit?: string, label?: string }>`

Store image file in Firebase Storage; store metadata + annotations in Firestore. Front-end: canvas overlay for drawing lines/points and editing measurements and labels.

### API / logic

- Upload: generate `storagePath`, upload file, get URL, create attachment doc with `annotations: []`.
- Update annotations: `updateDoc` on the attachment doc with new `annotations` array.
- No new REST API required if using Firestore + Storage client-side.

### UI components to add

- `JobImageUpload` – pick files, upload to Storage, list thumbnails with “Add dimensions” action.
- `ImageAnnotationEditor` – canvas over image, draw lines, add measurement value + unit + optional note; save to attachment doc.

---

## 4. Contract generation for jobs (DESIGN – to implement)

### Goals

- Admin defines a company-wide contract template (HTML or Markdown with placeholders).
- From a job, “Generate contract” fills placeholders (customer, job name, price, dates, etc.) and allows editing before saving.

### Suggested data model

- **`companies/{companyId}/settings/contractTemplate`** (document)
  - `body: string` (HTML or Markdown)
  - `placeholders: string[]` (e.g. `['customerName','jobName','totalPrice','startDate','endDate']`)
  - `updatedAt`, `updatedBy`

- **`companies/{companyId}/jobs/{jobId}/documents`** (subcollection) or **`companies/{companyId}/documents`** with `jobId`
  - `type: 'contract'`
  - `jobId: string`
  - `content: string` (filled template, editable)
  - `generatedAt`, `generatedBy`

### Logic

- Admin UI: edit contract template and list placeholders.
- “Generate contract” from job: load template, replace `{{customerName}}`, `{{jobName}}`, etc., from job + customer, create document, open in editor (rich text or textarea), then save.

### UI

- Settings or Company: “Smlouvy” – edit contract template.
- Job detail: button “Vytvořit smlouvu” → modal with preview/edit → save as document linked to job.

---

## 5. Invoices linked to jobs (DESIGN – to implement)

### Goals

- From a job, create “advance invoice” or “final invoice”.
- Invoice is linked to the job and appears in Documents.
- Customer and job info autofill; extensible for more document types.

### Suggested data model

- **Invoices** (existing or new collection, e.g. `companies/{companyId}/invoices`)
  - `jobId?: string`
  - `type: 'advance' | 'final'`
  - `customerId`, `customerName`, `customerAddress`, …
  - `items`, `total`, `dueDate`, `status`, …
  - `documentId?: string` – optional link to unified document record if you have one.

- **Documents** (if unified): `companies/{companyId}/documents`
  - `type: 'invoice' | 'contract' | 'receipt' | …`
  - `invoiceId?`, `contractJobId?`, …
  - So that “Documents” section can list all and filter by type/job.

### Logic

- Job detail: “Vytvořit zálohovou fakturu” / “Vytvořit závěrečnou fakturu” → create invoice with `jobId`, copy customer and job name/description into invoice, redirect to invoice edit or open in modal.
- Documents list: include invoices where `documentId` is set or where invoice has `jobId`; show in “Doklady” with filter by job.

### UI

- Job detail: two buttons (Zálohová faktura, Závěrečná faktura).
- Reuse existing invoice form; prefill from job and set `jobId` and `type`.

---

## 6. Implementation order

1. **Done:** Input styling; job template system (types, CRUD, dynamic form, job create + detail).
2. **Next:** Image annotation – Storage + attachment docs + canvas editor.
3. **Then:** Contract template in company settings + “Generate contract” from job + document save.
4. **Then:** Invoice creation from job (advance/final) + link in Documents.

If you want to proceed with a specific part (e.g. image annotation or contracts), say which one and we can implement it step by step in code.
