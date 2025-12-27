## DBcooper

- Do not add unnecessary comments unless absolutely necessary
- The project uses tauri for the backend (https://v2.tauri.app/)
- The project uses bun + react (ts) for the frontend
- The project uses sqlite as the primary database
- The project uses sqlx as the querybuilder and for database connections (https://sqlx.io/)
- For loading state, use shadcn spinner. If the button text is 'Test', the loading state should be '<Spinner> Test'. Do not alter the text
- Do not add any gap between icon and text in button, as the component already has it
- Run shadcn commands inside the src/ directory. Use shadcn cli to install components.
- Make sure components files don't get too big, split into multiple files if needed.