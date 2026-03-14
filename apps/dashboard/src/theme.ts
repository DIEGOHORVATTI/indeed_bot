import { createTheme, alpha } from '@mui/material/styles'

const GREY = {
  50: '#F9FAFB',
  100: '#F3F4F6',
  200: '#E5E7EB',
  300: '#D1D5DB',
  400: '#9CA3AF',
  500: '#919EAB',
  600: '#637381',
  700: '#454F5B',
  800: '#28323D',
  900: '#1C252E',
}

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#00A76F', light: '#5BE49B', dark: '#007867', contrastText: '#FFFFFF' },
    secondary: { main: GREY[800], light: GREY[700], dark: GREY[900], contrastText: GREY[500] },
    info: { main: '#00B8D9', light: '#61F3F3', dark: '#006C9C' },
    success: { main: '#22C55E', light: '#77ED8B', dark: '#118D57' },
    warning: { main: '#FFAB00', light: '#FFD666', dark: '#B76E00' },
    error: { main: '#FF5630', light: '#FFAC82', dark: '#B71D18' },
    grey: GREY,
    text: {
      primary: '#FFFFFF',
      secondary: GREY[500],
      disabled: alpha(GREY[500], 0.5),
    },
    background: {
      default: '#141A21',
      paper: '#1C252E',
    },
    divider: alpha(GREY[500], 0.2),
    action: {
      active: GREY[500],
      hover: alpha(GREY[500], 0.08),
      selected: alpha(GREY[500], 0.16),
      disabled: alpha(GREY[500], 0.5),
      disabledBackground: alpha(GREY[500], 0.24),
      focus: alpha(GREY[500], 0.24),
    },
  },
  typography: {
    fontFamily: '"Public Sans", system-ui, -apple-system, sans-serif',
    h4: { fontWeight: 700 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
    subtitle1: { fontWeight: 600 },
    subtitle2: { fontWeight: 600 },
    button: { fontWeight: 700, textTransform: 'none' },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: '#141A21' },
        '::-webkit-scrollbar': { width: 8, height: 8 },
        '::-webkit-scrollbar-thumb': {
          backgroundColor: alpha(GREY[500], 0.3),
          borderRadius: 4,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          borderRadius: 16,
          border: `1px solid ${alpha(GREY[500], 0.12)}`,
        },
      },
    },
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 8 },
        containedPrimary: {
          boxShadow: 'none',
          '&:hover': { boxShadow: 'none' },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, borderRadius: 6 },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: `1px solid ${alpha(GREY[500], 0.12)}` },
        head: {
          fontWeight: 600,
          color: GREY[500],
          backgroundColor: alpha(GREY[500], 0.08),
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: alpha(GREY[500], 0.2),
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: alpha(GREY[500], 0.4),
          },
        },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        root: { width: 46, height: 26, padding: 0 },
        switchBase: {
          padding: 3,
          '&.Mui-checked': {
            transform: 'translateX(20px)',
            '& + .MuiSwitch-track': { opacity: 1, backgroundColor: GREY[800] },
          },
        },
        thumb: { width: 20, height: 20 },
        track: { borderRadius: 13, opacity: 0.5, backgroundColor: GREY[700] },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 16 },
      },
    },
  },
})
