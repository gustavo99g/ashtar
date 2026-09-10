import "@/styles/App.css";
import { Chat } from "@/components/chat";
import { AppLayout } from "@/layouts/AppLayout";

function App() {
	return (
		<AppLayout>
			<Chat />
		</AppLayout>
	);
}

export default App;
