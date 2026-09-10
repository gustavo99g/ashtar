import "@/styles/App.css";
import { Chat } from "@/components/chat";
import { AppLayout } from "@/layouts/AppLayout";
import { Voice } from "./components/voice";

function App() {
	return (
		<AppLayout>
			<Voice />
		</AppLayout>
	);
}

export default App;
