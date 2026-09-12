import { createBrowserRouter } from "react-router-dom";
import { AppPage } from "@/pages/app";
import { LoginPage } from "@/pages/login";
import { SignupPage } from "@/pages/signup";

export const router = createBrowserRouter([
	{
		path: "/",
		element: <AppPage />,
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
		element: <AppPage />,
	},
]);
