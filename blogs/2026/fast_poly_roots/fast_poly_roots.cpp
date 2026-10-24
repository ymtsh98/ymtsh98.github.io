#include <bit>
#include <cstdint>

#include <algorithm>
#include <cmath>
#include <limits>
#include <numbers>

#if defined(_MSC_VER)
#define _FORCE_INLINE __forceinline
#include <intrin.h>
#include <immintrin.h>
#else
#define _FORCE_INLINE [[gnu::always_inline]] inline
#include <immintrin.h>
#endif

constexpr double pi2over3 = std::numbers::pi * 2.0 / 3.0;
constexpr double tolerance = 1e-10;

namespace fpr {

int solveQuadraticCatastCancell(double a, double b, double c, double* roots) {
  if (a == 0) {
    if (b == 0) return 0;
    roots[0] = -c / b;
    return 1;
  }

  double discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return 0;
  if (discriminant == 0) {
    roots[0] = -b / (2 * a);
    return 1;
  }

  double radical = std::sqrt(discriminant);

  roots[0] = 0.5 * (-b + radical) / a;
  roots[1] = 0.5 * (-b - radical) / a;

  if (roots[0] > roots[1]) std::swap(roots[0], roots[1]);

  return 2;
}

int solveQuadratic(double a, double b, double c, double* roots) {
  if (a == 0) {
    if (b == 0) return 0;
    roots[0] = -c / b;
    return 1;
  }

  double discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return 0;
  if (discriminant == 0) {
    roots[0] = -b / (2 * a);
    return 1;
  }

  double radical = std::sqrt(discriminant);

  double q = -0.5 * (b + std::copysign(radical, b));
  roots[0] = q / a;
  roots[1] = c / q;

  if (roots[0] > roots[1]) std::swap(roots[0], roots[1]);

  return 2;
}

static int solveCubicAnalytical(double a, double b, double c, double d, double* roots) {
  if (a == 0) return solveQuadratic(b, c, d, roots);

  double ba = b / a;
  double b3a = ba / 3.0;
  double ca = c / a;
  double da = d / a;

  double p = ca - ba * b3a;
  double q = 2.0 * b3a * b3a * b3a - b3a * ca + da;

  double tp = p / 3.0;
  double hq = 0.5 * q;

  double discriminant = hq * hq + tp * tp * tp;
  if (discriminant > 0.0) {
    double radical = std::sqrt(discriminant);
    // double u = std::cbrt(-hq + radical);
    // double v = std::cbrt(-hq - radical);
    double u = std::cbrt(-hq - std::copysign(radical, hq));
    double v = -tp / u;
    roots[0] = u + v - b3a;
    return 1;
  }

  if (discriminant == 0.0) {
    double u = std::cbrt(-hq);
    roots[0] = 2.0 * u - b3a;
    if (u == 0.0) return 1;

    roots[1] = -u - b3a;
    if (roots[0] > roots[1]) std::swap(roots[0], roots[1]);
    return 2;
  }

  double r = std::sqrt(-tp);
  double t = std::atan2(std::sqrt(-discriminant), -hq) / 3.0;
  for (int k = 0; k < 3; ++k) roots[k] = 2.0 * r * std::cos(t - k * pi2over3) - b3a;

  if (roots[0] > roots[1]) std::swap(roots[0], roots[1]);
  if (roots[1] > roots[2]) std::swap(roots[1], roots[2]);
  if (roots[0] > roots[1]) std::swap(roots[0], roots[1]);

  return 3;
}

_FORCE_INLINE double evaluateCubic(double a, double b, double c, double d, double x) {
  return ((a * x + b) * x + c) * x + d;
}

double safeguardedNewton(double a, double b, double c, double d, double left, double right, double last) {
  double da = 3 * a;
  double db = 2 * b;
  double x = 0.5 * (left + right);

  // if (right - left <= 2 * tolerance) return x;
  //
  // // fast newton
  // for (int i = 0; i < 2; ++i) {
  //   double eval = evaluateCubic(a, b, c, d, x);
  //   double next = x - eval / ((da * x + db) * x + c);
  //
  //   if (next < left) next = left;
  //   if (next > right) next = right;
  //
  //   double delta = next - x;
  //   if (std::abs(delta) <= tolerance) return next;
  //
  //   x = next;
  // }
  //
  // if (!std::isfinite(x)) x = 0.5 * (left + right);

  while (true) {
    double eval = evaluateCubic(a, b, c, d, x);
    if (eval == 0.) return x;

    if ((eval < 0.) == (last < 0.)) {
      left = x;
      last = eval;
    } else {
      right = x;
    }

    double next = x - eval / ((da * x + db) * x + c);
    double delta = next - x;

    if (next <= left || next >= right) {
      next = 0.5 * (left + right);
      if (next == x) return x;
    } else if (std::abs(delta) <= tolerance) {
      return next;
    }

    x = next;
  }

  return x;
}

int deflateCubic(double a, double b, double c, double d, double root, double* roots) {
  double B = b + a * root;
  double C = c + B * root;
  int n = solveQuadratic(a, B, C, roots);

  if (n == 0) return 0;

  for (int i = 0; i < n; ++i) {
    double x = roots[i];
    // refine with Newton's method
    for (int j = 0; j < 2; ++j) {
      // double derivative = (3 * a * x + 2 * b) * x + c;
      // if (derivative == 0.) break;
      // x -= evaluateCubic(a, b, c, d, x) / derivative;

      double ax = a * x;
      double bx = ax + b;
      double cx = bx * x + c;
      double y = cx * x + d;
      if (y == 0.) break;
      double derivative = (ax + bx) * x + cx;
      if (derivative == 0.) break;
      double next = x - y / derivative;
      if (next == x) break;
      x = next;
    }
    roots[i] = x;
  }

  if (n == 2 && roots[0] > roots[1]) {
    std::swap(roots[0], roots[1]);
  }

  return n;
}

int solveCubicYuksel(double a, double b, double c, double d, double xmin, double xmax, double* roots) {
  if (a == 0) return solveQuadratic(b, c, d, roots);

  if (xmin == -std::numeric_limits<double>::infinity() || xmax == std::numeric_limits<double>::infinity()) {
    // Fujiwara bound
    // double bound = std::abs(b / a);
    // double value = std::abs(c / a);
    // if (value > bound * bound) bound = std::sqrt(value);
    // value = std::abs(d / a);
    // if (value > bound * bound * bound) bound = std::cbrt(value);
    // bound *= 2.;
    // xmin = -bound;
    // xmax = bound;

    // Cauchy bound
    double bound = 1.0 + std::max(std::max(std::abs(b), std::abs(c)), std::abs(d)) / std::abs(a);
    xmin = std::max(xmin, -bound);
    xmax = std::min(xmax, bound);
  }

  double critical[2] = {};
  int n = solveQuadratic(3 * a, 2 * b, c, critical);
  double xa = critical[0], xb = critical[1];

  double start = evaluateCubic(a, b, c, d, xmin);
  double end = evaluateCubic(a, b, c, d, xmax);

  if (n <= 1 || xa >= xmax || xb <= xmin || (xa <= xmin && xb >= xmax)) {
    // [xmin, xmax] is entirely inside monotonic interval

    if (start == 0.) {
      roots[0] = xmin;
      return 1;
    }

    if (end == 0.) {
      roots[0] = xmax;
      return 1;
    }

    if ((start < 0.) == (end < 0.)) return 0; // no intersection

    // for robustness, we directly evaluate
    if (n == 1 && xa >= xmin && xa <= xmax) {
      double aval = evaluateCubic(a, b, c, d, xa);
      if (aval == 0.) {
        roots[0] = xa;
        return 1;
      }
    }

    roots[0] = safeguardedNewton(a, b, c, d, xmin, xmax, start);
    return 1;
  } else if (xa <= xmin) {
    // xb is inside
    // [xmin, xb]
    // [xb, xmax]

    double bval = evaluateCubic(a, b, c, d, xb);

    int r = 0;
    if (start == 0.) {
      roots[r++] = xmin;
    }
    if (start != 0. && bval != 0. && (start < 0.) != (bval < 0.)) {
      roots[r++] = safeguardedNewton(a, b, c, d, xmin, xb, start);
    }
    if (bval == 0.) {
      roots[r++] = xb;
    }
    if (bval != 0. && end != 0. && (bval < 0.) != (end < 0.)) {
      roots[r++] = safeguardedNewton(a, b, c, d, xb, xmax, bval);
    }
    if (end == 0.) {
      roots[r++] = xmax;
    }

    return r;

  } else if (xb >= xmax) {
    // xa is inside
    // [xmin, xa]
    // [xa, xmax]

    double aval = evaluateCubic(a, b, c, d, xa);

    int r = 0;
    if (start == 0.) {
      roots[r++] = xmin;
    }
    if (start != 0. && aval != 0. && (start < 0.) != (aval < 0.)) {
      roots[r++] = safeguardedNewton(a, b, c, d, xmin, xa, start);
    }
    if (aval == 0.) {
      roots[r++] = xa;
    }
    if (aval != 0. && end != 0. && (aval < 0.) != (end < 0.)) {
      roots[r++] = safeguardedNewton(a, b, c, d, xa, xmax, aval);
    }
    if (end == 0.) {
      roots[r++] = xmax;
    }

    return r;

  } else {
    // Both xa and xb are inside
    // [xmin, xa]
    // [xa, xb]
    // [xb, xmax]

    double aval = evaluateCubic(a, b, c, d, xa);
    double bval = evaluateCubic(a, b, c, d, xb);

    int r = 0;
    if (start == 0.) {
      roots[r++] = xmin;
      return r + deflateCubic(a, b, c, d, roots[0], roots + r);
    }
    if (start != 0. && aval != 0. && (start < 0.) != (aval < 0.)) {
      roots[r++] = safeguardedNewton(a, b, c, d, xmin, xa, start);
      return r + deflateCubic(a, b, c, d, roots[0], roots + r);
    }
    if (aval == 0.) {
      roots[r++] = xa;
      double other = -b / a - 2 * xa;
      if (other != xa) roots[r++] = other;
      return r;
    }
    if (aval != 0. && bval != 0. && (aval < 0.) != (bval < 0.)) {
      roots[r++] = safeguardedNewton(a, b, c, d, xa, xb, aval);
      return r + deflateCubic(a, b, c, d, roots[0], roots + r);
    }
    if (bval == 0.) {
      roots[r++] = xb;
      double other = -b / a - 2 * xb;
      if (other != xb) roots[r++] = other;
      return r;
    }
    if (bval != 0. && end != 0. && (bval < 0.) != (end < 0.)) {
      roots[r++] = safeguardedNewton(a, b, c, d, xb, xmax, bval);
      return r;
    }
    if (end == 0.) {
      roots[r++] = xmax;
    }

    return r;
  }

  return 0;
}


_FORCE_INLINE double aqrf(double value) {
  // approx outer root factor
  double value2 = value * value;
  double value4 = value2 * value2;
  double factor = (1.7320508075688772 + 0.3332382647851845 * value)
    + (-0.09505002786486583 + 0.04379925469027885 * value) * value2
    + (-0.017932902400303978 + 0.003894603220828943 * value) * value4;
  double square = factor * factor;
  return factor - ((square - 3.0) * factor - 2.0 * value) / (3.0 * (square - 1.0));
}

_FORCE_INLINE double acbrt(double value) {
  // approx cbrt
  double magnitude = std::abs(value);
  std::uint64_t bits = std::bit_cast<std::uint64_t>(magnitude);
  int exponent = static_cast<int>((bits >> 52) & 2047) - 1023;
  if (exponent == -1023 || exponent == 1024) return std::cbrt(value);

  double mantissa = std::bit_cast<double>((bits & 0x000fffffffffffffull) | 0x3ff0000000000000ull);
  int scale = exponent / 3;
  int remainder = exponent - 3 * scale;

  if (remainder < 0) {
    remainder += 3;
    --scale;
  }
  double mantissa2 = mantissa * mantissa;
  double mantissa4 = mantissa2 * mantissa2;
  double result = (0.5094594523524012 + 0.7115717290617645 * mantissa)
    + (-0.29420050703893974 + 0.08337335298168705 * mantissa) * mantissa2
    - 0.010180273440074014 * mantissa4;
  constexpr double factors[3] = {1., 1.2599210498948732, 1.5874010519681994};
  double factor = std::bit_cast<double>(static_cast<std::uint64_t>(scale + 1023) << 52);
  double cube = result * result * result;
  result *= (cube + 2. * mantissa) / (2. * cube + mantissa);
  result *= factor * factors[remainder];
  return value < 0. ? -result : result;
}

_FORCE_INLINE double fastNewton(double a, double b, double c, double d, double x) {
  for (int i = 0; i < 8; ++i) {
    double ax = a * x;
    double bx = ax + b;
    double cx = bx * x + c;
    double y = cx * x + d;
    if (y == 0.) break;

    double derivative = (ax + bx) * x + cx;
    double next = x - y / derivative;
    double step = next - x;
    x = next;
    if (std::abs(step) <= tolerance) break;
  }

  return x;
}

_FORCE_INLINE __m128d fastNewton2(double a, double b, double c, double d, __m128d x) {
  __m128d a2 = _mm_set1_pd(a);
  __m128d b2 = _mm_set1_pd(b);
  __m128d c2 = _mm_set1_pd(c);
  __m128d d2 = _mm_set1_pd(d);
  __m128d zero = _mm_setzero_pd();
  __m128d sign = _mm_set1_pd(-0.0);
  __m128d threshold = _mm_set1_pd(tolerance);
  __m128d active = _mm_cmpeq_pd(zero, zero);

  for (int i = 0; i < 8; ++i) {
    __m128d ax = _mm_mul_pd(a2, x);
    __m128d bx = _mm_add_pd(ax, b2);
    __m128d cx = _mm_add_pd(_mm_mul_pd(bx, x), c2);
    __m128d y = _mm_add_pd(_mm_mul_pd(cx, x), d2);
    active = _mm_and_pd(active, _mm_cmpneq_pd(y, zero));
    if (_mm_movemask_pd(active) == 0) break;

    __m128d derivative = _mm_add_pd(_mm_mul_pd(_mm_add_pd(ax, bx), x), cx);
    __m128d next = _mm_sub_pd(x, _mm_div_pd(y, derivative));
    __m128d step = _mm_sub_pd(next, x);
    x = _mm_or_pd(_mm_and_pd(active, next), _mm_andnot_pd(active, x));
    active = _mm_andnot_pd(_mm_cmple_pd(_mm_andnot_pd(sign, step), threshold), active);
    if (_mm_movemask_pd(active) == 0) break;
  }

  return x;
}

int deflateCubic2(double a, double b, double c, double d, double root, double* roots) {
  roots[0] = root;
  double B = b + a * root;
  double C = c + B * root;
  int n = 1 + solveQuadratic(a, B, C, roots + 1);
  if (n == 1) return 1;

  if (n == 3) {
    __m128d x = _mm_loadu_pd(roots + 1);
    _mm_storeu_pd(roots + 1, fastNewton2(a, b, c, d, x));
  } else {
    roots[1] = fastNewton(a, b, c, d, roots[1]);
  }

  if (n == 3 && roots[1] > roots[2]) std::swap(roots[1], roots[2]);

  if (roots[0] > roots[1]) {
    std::swap(roots[0], roots[1]);
    if (n == 3 && roots[1] > roots[2]) std::swap(roots[1], roots[2]);
  }

  if (n == 2) return 1 + (roots[0] != roots[1]);
  if (roots[0] == roots[1]) {
    roots[1] = roots[2];
    return 1 + (roots[0] != roots[1]);
  }

  return 2 + (roots[1] != roots[2]);
}

int solveCubicMixed(double a, double b, double c, double d, double xmin, double xmax, double* roots) {
  if (a == 0) return solveQuadratic(b, c, d, roots);
  if (d == 0) return deflateCubic2(a, b, c, d, 0., roots);

  double ba = b / a;
  double b3a = ba / 3.0;
  double ca = c / a;
  double da = d / a;

  double p = ca - ba * b3a;
  double q = 2.0 * b3a * b3a * b3a - b3a * ca + da;

  double tp = p / 3.0;
  double hq = 0.5 * q;

  double discriminant = hq * hq + tp * tp * tp;
  if (discriminant > 0.0) {
    double radical = std::sqrt(discriminant);
    double u = acbrt(-hq - std::copysign(radical, hq));
    double v = -tp / u;
    double root = u + v - b3a;
    roots[0] = fastNewton(a, b, c, d, root);
    return 1;
  }

  if (discriminant == 0.0) {
    double u = acbrt(-hq);
    double root = 2.0 * u - b3a;
    if (u == 0.0) {
      roots[0] = fastNewton(a, b, c, d, root);
      return 1;
    }

    __m128d x = _mm_set_pd(-u - b3a, root);
    _mm_storeu_pd(roots, fastNewton2(a, b, c, d, x));
    if (roots[0] > roots[1]) std::swap(roots[0], roots[1]);
    return 2;
  }

  double r = std::sqrt(-tp);
  double t = std::abs(hq) / (-tp * r);
  double factor = aqrf(t);
  double root = -std::copysign(r * factor, hq) - b3a;

  root = fastNewton(a, b, c, d, root);
  return deflateCubic2(a, b, c, d, root, roots);
}

}

extern "C" {

  double* getRoots() {
    static double roots[3];
    return roots;
  }

  int solveCubicYuksel(double a, double b, double c, double d, double xmin, double xmax, double* roots) {
    return fpr::solveCubicYuksel(a, b, c, d, xmin, xmax, roots);
  }

  int solveCubicMixed(double a, double b, double c, double d, double xmin, double xmax, double* roots) {
    return fpr::solveCubicMixed(a, b, c, d, xmin, xmax, roots);
  }

  int solveCubicAnalytical(double a, double b, double c, double d, double* roots) {
    return fpr::solveCubicAnalytical(a, b, c, d, roots);
  }

}
