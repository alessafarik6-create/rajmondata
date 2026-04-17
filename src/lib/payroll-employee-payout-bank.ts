/**
 * Napojení modulu mzdy / výplat na bankovní údaje zaměstnance.
 *
 * Při schvalování výplat nebo přípravě exportu pro banku použijte:
 * `getEmployeeBankAccountForPayroll(employeeDoc)` z `@/lib/employee-bank-account`.
 *
 * Data jsou v `companies/{companyId}/employees/{employeeId}.bankAccount`.
 */

export { getEmployeeBankAccountForPayroll } from "@/lib/employee-bank-account";
