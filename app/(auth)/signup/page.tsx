"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { unstable_rethrow } from "next/navigation"
import { useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import type { z } from "zod"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"

import { signUpAction } from "@/app/(auth)/actions"
import { SignupSchema } from "@/lib/auth/schema"

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Etwas ist schiefgelaufen. Bitte versuche es erneut."
}

export default function SignupPage() {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmationNeeded, setConfirmationNeeded] = useState(false)

  const form = useForm({
    resolver: zodResolver(SignupSchema),
    defaultValues: { email: "", password: "", confirmPassword: "" },
    mode: "onChange",
    reValidateMode: "onChange",
  })

  const onSubmit = (data: z.infer<typeof SignupSchema>) => {
    setError(null)
    setConfirmationNeeded(false)

    startTransition(async () => {
      try {
        // If the action redirected (signup produced a live session), the
        // `await` below throws NEXT_REDIRECT and we never reach this line —
        // so `result` here is only ever the non-redirect outcome.
        const result = await signUpAction(data)
        if ("error" in result) {
          setError(result.error)
          return
        }
        if (result.data.needsEmailConfirmation) {
          setConfirmationNeeded(true)
        }
      } catch (e) {
        unstable_rethrow(e)
        setError(getErrorMessage(e))
      }
    })
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Konto erstellen</CardTitle>
          <CardDescription>
            Registriere dich mit E-Mail-Adresse und Passwort.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {confirmationNeeded ? (
            <Alert data-test="signup-confirmation-alert">
              <AlertDescription>
                Wir haben dir einen Bestätigungslink per E-Mail geschickt.
                Klicke ihn an, um dein Konto zu aktivieren. Nach der
                Bestätigung kannst du dich alternativ auch mit einem{" "}
                <Link
                  href="/login"
                  className="underline underline-offset-4"
                  data-test="signup-confirmation-login-link"
                >
                  E-Mail-Code
                </Link>{" "}
                statt mit Passwort anmelden.
              </AlertDescription>
            </Alert>
          ) : (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                {error && (
                  <Alert variant="destructive" data-test="signup-error">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <FormField
                  name="email"
                  control={form.control}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>E-Mail</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          autoComplete="email"
                          placeholder="du@beispiel.de"
                          data-test="signup-email-input"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  name="password"
                  control={form.control}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Passwort</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          placeholder="••••••••"
                          data-test="signup-password-input"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  name="confirmPassword"
                  control={form.control}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Passwort bestätigen</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          placeholder="••••••••"
                          data-test="signup-confirm-password-input"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full"
                  disabled={pending}
                  data-test="signup-submit-button"
                >
                  {pending ? "Konto wird erstellt…" : "Registrieren"}
                </Button>
              </form>
            </Form>
          )}

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Schon ein Konto?{" "}
            <Link
              href="/login"
              className="text-primary underline-offset-4 hover:underline"
              data-test="signup-login-link"
            >
              Anmelden
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
