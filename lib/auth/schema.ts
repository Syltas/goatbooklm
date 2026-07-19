import { z } from "zod"

export const LoginPasswordSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
})

export const LoginOtpRequestSchema = z.object({
  email: z.email("Enter a valid email address"),
})

export const LoginOtpVerifySchema = z.object({
  email: z.email("Enter a valid email address"),
  token: z
    .string()
    .regex(/^\d{6}$/, "Enter the 6-digit code"),
})

export const SignupSchema = z
  .object({
    email: z.email("Enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })

export type LoginPasswordInput = z.infer<typeof LoginPasswordSchema>
export type LoginOtpRequestInput = z.infer<typeof LoginOtpRequestSchema>
export type LoginOtpVerifyInput = z.infer<typeof LoginOtpVerifySchema>
export type SignupInput = z.infer<typeof SignupSchema>
