import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function SignupPage() {
	return (
		<main className="flex min-h-screen items-center justify-center bg-surface px-4">
			<div className="w-full max-w-sm">
				<div className="mb-8 text-center">
					<h1 className="text-2xl font-bold text-primary">Criar uma conta</h1>

					<p className="mt-2 text-sm text-muted">
						Crie sua conta para entrar na comunidade.
					</p>
				</div>

				<form className="space-y-4">
					<div className="space-y-1.5">
						<label
							htmlFor="username"
							className="text-sm font-medium text-secondary"
						>
							Nome de usuário
						</label>

						<input
							id="username"
							type="text"
							placeholder="Seu nome"
							className="
                h-10 w-full rounded-md border border-line
                bg-input px-3 text-sm text-primary outline-none
                placeholder:text-muted
                focus:border-line-focus
              "
						/>
					</div>

					<div className="space-y-1.5">
						<label
							htmlFor="email"
							className="text-sm font-medium text-secondary"
						>
							E-mail
						</label>

						<input
							id="email"
							type="email"
							placeholder="seu@email.com"
							className="
                h-10 w-full rounded-md border border-line
                bg-input px-3 text-sm text-primary outline-none
                placeholder:text-muted
                focus:border-line-focus
              "
						/>
					</div>

					<div className="space-y-1.5">
						<label
							htmlFor="password"
							className="text-sm font-medium text-secondary"
						>
							Senha
						</label>

						<input
							id="password"
							type="password"
							placeholder="Sua senha"
							className="
                h-10 w-full rounded-md border border-line
                bg-input px-3 text-sm text-primary outline-none
                placeholder:text-muted
                focus:border-line-focus
              "
						/>
					</div>

					<div className="space-y-1.5">
						<label
							htmlFor="confirm-password"
							className="text-sm font-medium text-secondary"
						>
							Confirmar senha
						</label>

						<input
							id="confirm-password"
							type="password"
							placeholder="Repita sua senha"
							className="
                h-10 w-full rounded-md border border-line
                bg-input px-3 text-sm text-primary outline-none
                placeholder:text-muted
                focus:border-line-focus
              "
						/>
					</div>

					<Button type="submit" className="w-full">
						Criar conta
					</Button>
				</form>

				<p className="mt-6 text-center text-sm text-muted">
					Já tem uma conta?{" "}
					<Link
						to="/login"
						className="text-link hover:text-link-hover hover:underline"
					>
						Entrar
					</Link>
				</p>
			</div>
		</main>
	);
}
