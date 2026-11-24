import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-semibold">Página não encontrada</h1>
      <p className="text-sm text-muted-foreground">
        O recurso não existe ou você não tem acesso a ele.
      </p>
      <Link href="/" className="text-sm text-primary hover:underline">
        Voltar ao início
      </Link>
    </div>
  );
}
