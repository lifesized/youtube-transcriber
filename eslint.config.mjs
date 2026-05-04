import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextVitals,
  {
    ignores: [".venv/**", ".private/**", "lib/generated/**", "emails/**"],
  },
];

export default eslintConfig;
