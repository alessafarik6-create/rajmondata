import {
  MIN_EMPLOYEE_PASSWORD_LENGTH,
  passwordPolicyError,
} from "@/lib/employee-password-policy";

export const PASSWORD_MISMATCH_MESSAGE = "Hesla se neshodují.";

export type NewPasswordFormValues = {
  password: string;
  confirm: string;
};

export type NewPasswordFormErrors = {
  password?: string;
  confirm?: string;
  form?: string;
};

export function validateNewPasswordForm(
  values: NewPasswordFormValues
): NewPasswordFormErrors {
  const errors: NewPasswordFormErrors = {};
  const password = values.password.trim();
  const confirm = values.confirm.trim();

  if (!password) {
    errors.password = "Vyplňte nové heslo.";
  } else {
    const policyErr = passwordPolicyError(password);
    if (policyErr) errors.password = policyErr;
  }

  if (!confirm) {
    errors.confirm = "Potvrďte nové heslo.";
  } else if (password && confirm && password !== confirm) {
    errors.confirm = PASSWORD_MISMATCH_MESSAGE;
  }

  return errors;
}

export function hasNewPasswordFormErrors(errors: NewPasswordFormErrors): boolean {
  return Boolean(errors.password || errors.confirm || errors.form);
}

export { MIN_EMPLOYEE_PASSWORD_LENGTH };
