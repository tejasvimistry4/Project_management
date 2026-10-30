export const COMMON_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
} as const;

export const PUBLIC_USER_PROFILE_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  createdAt: true,
} as const;
