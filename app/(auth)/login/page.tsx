"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { unstable_rethrow } from "next/navigation"
import { useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import {
  requestLoginOtpAction,
  signInWithPasswordAction,
  verifyLoginOtpAction,
} from "@/app/(auth)/actions"
import {
  LoginOtpRequestSchema,
  LoginOtpVerifySchema,
  LoginPasswordSchema,
} from "@/lib/auth/schema"

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Etwas ist schiefgelaufen. Bitte versuche es erneut."
}

function PasswordLoginForm() {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const form = useForm({
    resolver: zodResolver(LoginPasswordSchema),
    defaultValues: { email: "", password: "" },
    mode: "onChange",
    reValidateMode: "onChange",
  })

  const onSubmit = (data: z.infer<typeof LoginPasswordSchema>) => {
    setError(null)

    startTransition(async () => {
      try {
        const result = await signInWithPasswordAction(data)
        if ("error" in result) {
          setError(result.error)
        }
      } catch (e) {
        unstable_rethrow(e)
        setError(getErrorMessage(e))
      }
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {error && (
          <Alert variant="destructive" data-test="login-password-error">
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
                  data-test="login-password-email-input"
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
                  autoComplete="current-password"
                  placeholder="••••••••"
                  data-test="login-password-password-input"
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
          data-test="login-password-submit-button"
        >
          {pending ? "Anmeldung läuft…" : "Anmelden"}
        </Button>
      </form>
    </Form>
  )
}

function OtpLoginForm() {
  const [step, setStep] = useState<"request" | "verify">("request")
  const [email, setEmail] = useState("")
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const requestForm = useForm({
    resolver: zodResolver(LoginOtpRequestSchema),
    defaultValues: { email: "" },
    mode: "onChange",
    reValidateMode: "onChange",
  })

  const verifyForm = useForm({
    resolver: zodResolver(LoginOtpVerifySchema),
    defaultValues: { email: "", token: "" },
    mode: "onChange",
    reValidateMode: "onChange",
  })

  const onRequest = (data: z.infer<typeof LoginOtpRequestSchema>) => {
    setError(null)

    startTransition(async () => {
      try {
        const result = await requestLoginOtpAction(data)
        if ("error" in result) {
          setError(result.error)
          return
        }
        setEmail(data.email)
        verifyForm.setValue("email", data.email)
        setStep("verify")
        toast.success("Code gesendet — prüfe dein Postfach")
      } catch (e) {
        unstable_rethrow(e)
        setError(getErrorMessage(e))
      }
    })
  }

  const onVerify = (data: z.infer<typeof LoginOtpVerifySchema>) => {
    setError(null)

    startTransition(async () => {
      try {
        const result = await verifyLoginOtpAction(data)
        if ("error" in result) {
          setError(result.error)
        }
      } catch (e) {
        unstable_rethrow(e)
        setError(getErrorMessage(e))
      }
    })
  }

  if (step === "request") {
    return (
      <Form {...requestForm}>
        <form
          onSubmit={requestForm.handleSubmit(onRequest)}
          className="space-y-4"
        >
          {error && (
            <Alert variant="destructive" data-test="login-otp-request-error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <FormField
            name="email"
            control={requestForm.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>E-Mail</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="du@beispiel.de"
                    data-test="login-otp-email-input"
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
            data-test="login-otp-request-button"
          >
            {pending ? "Wird gesendet…" : "Code senden"}
          </Button>
        </form>
      </Form>
    )
  }

  return (
    <Form {...verifyForm}>
      <form onSubmit={verifyForm.handleSubmit(onVerify)} className="space-y-4">
        {error && (
          <Alert variant="destructive" data-test="login-otp-verify-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <p className="text-sm text-muted-foreground">
          Gib den 6-stelligen Code ein, der an{" "}
          <span className="font-medium text-foreground">{email}</span>{" "}
          gesendet wurde.
        </p>

        <FormField
          name="token"
          control={verifyForm.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Code</FormLabel>
              <FormControl>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  data-test="login-otp-token-input"
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
          data-test="login-otp-verify-button"
        >
          {pending ? "Wird bestätigt…" : "Code bestätigen"}
        </Button>

        <Button
          type="button"
          variant="ghost"
          className="w-full"
          data-test="login-otp-back-button"
          onClick={() => {
            setError(null)
            setStep("request")
          }}
        >
          Andere E-Mail verwenden
        </Button>
      </form>
    </Form>
  )
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Anmelden</CardTitle>
          <CardDescription>
            Melde dich mit deinem Passwort oder einem Einmal-Code per E-Mail
            an.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="password">
            <TabsList className="mb-4 grid w-full grid-cols-2">
              <TabsTrigger value="password" data-test="login-tab-password">
                Passwort
              </TabsTrigger>
              <TabsTrigger value="otp" data-test="login-tab-otp">
                E-Mail-Code
              </TabsTrigger>
            </TabsList>
            <TabsContent value="password">
              <PasswordLoginForm />
            </TabsContent>
            <TabsContent value="otp">
              <OtpLoginForm />
            </TabsContent>
          </Tabs>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Noch kein Konto?{" "}
            <Link
              href="/signup"
              className="text-primary underline-offset-4 hover:underline"
              data-test="login-signup-link"
            >
              Registrieren
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
