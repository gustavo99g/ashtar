import { createBrowserRouter } from "react-router-dom";
import { AppLayout } from "@/layouts/AppLayout";
import { LoginPage } from "@/routes/login";
import { SignupPage } from "@/routes/signup";

export const router = createBrowserRouter([
	{
		path: "/",
		element: <AppLayout />,
	},
	{
		path: "/login",
		element: <LoginPage />,
	},
	{
		path: "/signup",
		element: <SignupPage />,
	},
	{
		path: "/app",
		element: <AppLayout />,
	},
]);
