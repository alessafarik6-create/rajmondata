
export type Role = 
  | 'super_admin' 
  | 'billing_admin' 
  | 'company_owner' 
  | 'company_admin' 
  | 'manager' 
  | 'accountant' 
  | 'employee' 
  | 'customer';

export type Plan = 'Starter' | 'Professional' | 'Enterprise';

export interface Company {
  id: string;
  name: string;
  logo?: string;
  plan: Plan;
  status: 'active' | 'suspended' | 'pending';
  modules: string[];
  createdAt: string;
  ownerId: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  companyId?: string;
  avatar?: string;
}

export interface Job {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  companyId: string;
  assignedTo?: string;
}

export interface Attendance {
  id: string;
  userId: string;
  companyId: string;
  checkIn: string;
  checkOut?: string;
  date: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  companyId: string;
  phone?: string;
}
