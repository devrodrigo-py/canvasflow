"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Github, Mail, Loader2 } from "lucide-react";
import { safeRedirectPath } from "@/lib/utils";

const AUTH_ERRORS: Record<string, string> = {
  auth_failed: "Não foi possível concluir a autenticação. Tente novamente.",
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [info, setInfo] = useState("");
  const [next, setNext] = useState("/");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNext(safeRedirectPath(params.get("next")));
    const code = params.get("error");
    if (code) setError(AUTH_ERRORS[code] ?? "Erro de autenticação");
  }, []);

  const callbackUrl = (target: string) =>
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(target)}`;

  // Cliente criado sob demanda: evita instanciar Supabase durante o prerender do build
  const getSupabase = () => createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setInfo("");
    const supabase = getSupabase();

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: callbackUrl(next),
          },
        });
        if (error) throw error;
        if (data.session) {
          // Autoconfirm ativo: signup já autentica
          window.location.href = next;
          return;
        }
        setInfo("Verifique seu email para confirmar a conta.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        // A raiz "/" resolve o workspace e projeto reais do usuário e redireciona
        window.location.href = next;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao autenticar");
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError("Informe seu email para recuperar a senha.");
      return;
    }
    setIsLoading(true);
    setError("");
    const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: callbackUrl("/auth/update-password"),
    });
    setIsLoading(false);
    if (error) setError(error.message);
    else setInfo("Se o email existir, enviamos um link para redefinir a senha.");
  };

  const handleOAuth = async (provider: "github" | "google") => {
    setIsLoading(true);
    const supabase = getSupabase();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: callbackUrl(next),
      },
    });
    if (error) {
      setError(error.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">CanvasFlow AI</CardTitle>
          <CardDescription>
            {isSignUp ? "Crie sua conta para começar" : "Entre para acessar seu workspace"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {info && (
            <Alert>
              <AlertDescription>{info}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Senha</Label>
                {!isSignUp && (
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-xs text-primary hover:underline"
                    disabled={isLoading}
                  >
                    Esqueci a senha
                  </button>
                )}
              </div>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={isSignUp ? "new-password" : "current-password"}
                disabled={isLoading}
              />
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isSignUp ? "Criando conta..." : "Entrando..."}
                </>
              ) : isSignUp ? (
                "Criar conta"
              ) : (
                "Entrar"
              )}
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Ou continue com</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              onClick={() => handleOAuth("github")}
              disabled={isLoading}
            >
              <Github className="mr-2 h-4 w-4" />
              GitHub
            </Button>
            <Button
              variant="outline"
              onClick={() => handleOAuth("google")}
              disabled={isLoading}
            >
              <Mail className="mr-2 h-4 w-4" />
              Google
            </Button>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            {isSignUp ? "Já tem conta? " : "Não tem conta? "}
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError("");
              }}
              className="text-primary hover:underline"
            >
              {isSignUp ? "Entrar" : "Criar conta"}
            </button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}