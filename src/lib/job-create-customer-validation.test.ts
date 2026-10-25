import {
  validateCustomerEmail,
  validateCustomerPhone,
  validateNewCustomerForJob,
  hasFieldErrors,
} from "./job-create-customer-validation";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function run() {
  assert(validateCustomerEmail("") !== null, "empty email");
  assert(validateCustomerEmail("a@b.cz") === null, "valid email");
  assert(validateCustomerPhone("123") !== null, "short phone");
  assert(validateCustomerPhone("+420 777 123 456") === null, "valid phone");

  const ok = validateNewCustomerForJob({
    name: "Novák",
    email: "a@b.cz",
    phone: "777123456",
    address: "Praha 1",
  });
  assert(!hasFieldErrors(ok), "full valid");

  const bad = validateNewCustomerForJob({
    name: "",
    email: "x",
    phone: "",
    address: "",
  });
  assert(hasFieldErrors(bad), "all invalid");
  console.log("job-create-customer-validation.test.ts OK");
}

run();
