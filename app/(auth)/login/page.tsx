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
    : "Something went wrong. Please try again."
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
        if (result?.error) {
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
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
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
              <FormLabel>Password</FormLabel>
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
          {pending ? "Signing in…" : "Sign in"}
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
        if (result?.error) {
          setError(result.error)
          return
        }
        setEmail(data.email)
        verifyForm.setValue("email", data.email)
        setStep("verify")
        toast.success("Code sent — check your inbox")
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
        if (result?.error) {
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
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
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
            {pending ? "Sending…" : "Send code"}
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
          Enter the 6-digit code sent to{" "}
          <span className="font-medium text-foreground">{email}</span>.
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
          {pending ? "Verifying…" : "Verify code"}
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
          Use a different email
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
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Sign in with your password or a one-time email code.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="password">
            <TabsList className="mb-4 grid w-full grid-cols-2">
              <TabsTrigger value="password" data-test="login-tab-password">
                Password
              </TabsTrigger>
              <TabsTrigger value="otp" data-test="login-tab-otp">
                Email code
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
            Don&apos;t have an account?{" "}
            <Link
              href="/signup"
              className="text-primary underline-offset-4 hover:underline"
              data-test="login-signup-link"
            >
              Sign up
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
