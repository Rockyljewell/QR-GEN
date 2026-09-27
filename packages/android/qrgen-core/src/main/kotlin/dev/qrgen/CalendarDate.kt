package dev.qrgen

import java.util.Calendar

/**
 * A calendar date without time zone, used by the parsers. It avoids `java.time`, which needs
 * Android API 26 (or core library desugaring).
 */
public data class CalendarDate(public val year: Int, public val month: Int, public val day: Int) : Comparable<CalendarDate> {
    init {
        require(month in 1..12) { "month must be 1..12 (was $month)" }
        require(day in 1..daysInMonth(year, month)) { "day $day is not valid for $year-$month" }
    }

    override fun compareTo(other: CalendarDate): Int = compareValuesBy(this, other, { it.year }, { it.month }, { it.day })

    /** Whole years from this date until [other] (for example an age), negative if [other] is earlier. */
    public fun yearsUntil(other: CalendarDate): Int {
        var years = other.year - year
        if (other.month < month || (other.month == month && other.day < day)) years--
        return years
    }

    /** ISO 8601 `YYYY-MM-DD`. */
    override fun toString(): String = iso(year, month, day)

    public companion object {
        /** Today in the device's default time zone. */
        @JvmStatic
        public fun today(): CalendarDate {
            val c = Calendar.getInstance()
            return CalendarDate(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
        }

        /** Returns a date, or `null` when the fields do not form a valid date. */
        @JvmStatic
        public fun of(year: Int, month: Int, day: Int): CalendarDate? =
            if (month in 1..12 && day in 1..daysInMonth(year, month)) CalendarDate(year, month, day) else null

        /** Parses `YYYY-MM-DD`; returns `null` for anything else. */
        @JvmStatic
        public fun parse(iso: String): CalendarDate? {
            val m = Regex("^(\\d{4})-(\\d{2})-(\\d{2})").find(iso) ?: return null
            return of(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt())
        }

        @JvmStatic
        public fun isLeapYear(year: Int): Boolean = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0

        @JvmStatic
        public fun daysInMonth(year: Int, month: Int): Int = when (month) {
            1, 3, 5, 7, 8, 10, 12 -> 31
            4, 6, 9, 11 -> 30
            2 -> if (isLeapYear(year)) 29 else 28
            else -> 0
        }

        internal fun iso(year: Int, month: Int, day: Int): String =
            year.toString().padStart(4, '0') + "-" + month.toString().padStart(2, '0') + "-" + day.toString().padStart(2, '0')
    }
}
