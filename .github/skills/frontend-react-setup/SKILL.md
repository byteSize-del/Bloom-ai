---
name: frontend-react-setup
description: 'Use when: setting up a new React front-end project with best practices for file structure, tooling, and development workflow.'
---

# Front-End React Project Setup Skill

This skill guides you through setting up a new React project with industry best practices for file structure, tooling, and development workflow.

## When to Use This Skill

Use this skill when:
- Starting a new React project from scratch
- Setting up a new feature branch that requires standardized project structure
- Onboarding new team members to ensure consistent project setup
- Refactoring an existing project to follow React best practices

## Step-by-Step Process

### 1. Project Initialization
- Create project directory and initialize with npm/yarn
- Set up React with Create React App, Vite, or custom webpack configuration
- Configure TypeScript if applicable
- Set up ESLint and Prettier for code formatting
- Configure Jest and React Testing Library for testing

### 2. File Structure Organization
- Establish consistent component organization (atomic design or feature-based)
- Set up proper separation of concerns (components, hooks, utils, assets, styles)
- Configure absolute imports for cleaner import paths
- Set up environment variable handling

### 3. Development Tooling Configuration
- Configure hot module replacement (HMR) for fast development
- Set up husky for pre-commit hooks
- Configure lint-staged for automated code formatting
- Set up VS Code workspace settings for consistent editor experience
- Configure browser debugging support

### 4. Build and Deployment Preparation
- Set up production build optimizations
- Configure code splitting and lazy loading
- Set up asset optimization (images, fonts, SVGs)
- Configure deployment scripts for various platforms (Netlify, Vercel, etc.)

### 5. Documentation and Standards
- Create README with project setup instructions
- Establish coding standards and conventions document
- Set up contribution guidelines
- Create component library documentation if applicable

## Quality Criteria

When this skill is complete, you should have:
- A working React development environment with hot reloading
- Consistent code formatting enforced by ESLint and Prettier
- Test setup with Jest and React Testing Library
- Clear file structure that follows React community best practices
- Documentation for team onboarding and project maintenance
- Build scripts optimized for production deployment

## Example Prompts to Try This Skill

- "/frontend-react-setup create a new React dashboard project"
- "/frontend-react-setup set up a React library with TypeScript"
- "/frontend-react-setup initialize a React project with testing and CI/CD"

## Related Customizations to Create Next

After using this skill, consider creating:
- Specific component library skills (buttons, forms, layouts)
- State management setup skills (Redux, Zustand, React Query)
- Styling solution skills (CSS Modules, Styled Components, Tailwind)
- Testing strategy skills (unit, integration, e2e testing)