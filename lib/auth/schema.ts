import { z } from "zod"

export const LoginPasswordSchema = z.object({
  email: z.email("Gib eine gültige E-Mail-Adresse ein"),
  password: z.string().min(1, "Passwort ist erforderlich"),
})

export const LoginOtpRequestSchema = z.object({
  email: z.email("Gib eine gültige E-Mail-Adresse ein"),
})

export const LoginOtpVerifySchema = z.object({
  email: z.email("Gib eine gültige E-Mail-Adresse ein"),
  token: z
    .string()
    .regex(/^\d{6}$/, "Gib den 6-stelligen Code ein"),
})

export const SignupSchema = z
  .object({
    email: z.email("Gib eine gültige E-Mail-Adresse ein"),
    password: z.string().min(8, "Passwort muss mindestens 8 Zeichen lang sein"),
    confirmPassword: z.string().min(1, "Bestätige dein Passwort"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwörter stimmen nicht überein",
    path: ["confirmPassword"],
  })

export type LoginPasswordInput = z.infer<typeof LoginPasswordSchema>
export type LoginOtpRequestInput = z.infer<typeof LoginOtpRequestSchema>
export type LoginOtpVerifyInput = z.infer<typeof LoginOtpVerifySchema>
export type SignupInput = z.infer<typeof SignupSchema>
