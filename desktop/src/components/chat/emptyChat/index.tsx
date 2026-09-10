const EmptyChat = () => {
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center px-6">
			<div className="max-w-md text-center">
				<div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-raised text-2xl text-muted">
					#
				</div>

				<h2 className="text-lg font-semibold text-primary">
					Bem-vindo ao #general
				</h2>

				<p className="mt-1 text-sm text-muted">
					Este é o começo do canal. Envie uma mensagem para começar a conversa.
				</p>
			</div>
		</div>
	);
};

export { EmptyChat };
