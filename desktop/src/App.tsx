import "@/styles/App.css";
import { Button } from "@/components/ui/button";

function App() {
	return (
		<div className="flex h-screen w-screen ">
			<main className="h-96">
				<h1 className="text-4xl ">Tauri app</h1>
				<Button>DISCORD</Button>
			</main>
		</div>
	);
}

export default App;
