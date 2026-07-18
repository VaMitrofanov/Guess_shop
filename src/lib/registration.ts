import { z } from "zod";

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10).max(128),
  name: z.string().optional(),
  agreedToPrivacy: z.literal(true),
});
