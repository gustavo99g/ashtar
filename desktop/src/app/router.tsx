import { createBrowserRouter } from "react-router-dom";
import { ServerRoute } from "@/routes/server";

export const router = createBrowserRouter([
	{
		path: "/",
		element: <ServerRoute />,
	},
]);
