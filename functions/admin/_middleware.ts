import { adminGuard } from "../../lib/auth";
export const onRequest = adminGuard;
