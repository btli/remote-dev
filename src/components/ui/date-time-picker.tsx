"use client";

import * as React from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Clock face component with clickable numbers
type ClockView = "hours" | "minutes" | "seconds";

interface ClockFaceProps {
  value: number;
  view: ClockView;
  onChange: (value: number) => void;
  onViewChange: (view: ClockView) => void;
  is24Hour?: boolean;
}

function ClockFace({ value, view, onChange, onViewChange, is24Hour = false }: ClockFaceProps) {
  const size = 140;
  const center = size / 2;
  const outerRadius = size / 2 - 12;
  const innerRadius = outerRadius - 24; // For 24-hour inner ring

  // Generate numbers based on view
  const getNumbers = () => {
    if (view === "hours") {
      if (is24Hour) {
        // Outer ring: 1-12, Inner ring: 13-24 (with 0 at 12 position)
        return {
          outer: [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
          inner: [0, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
        };
      }
      return { outer: [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], inner: null };
    }
    // Minutes and seconds: 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55
    return { outer: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55], inner: null };
  };

  const numbers = getNumbers();

  // Calculate position for a number on the clock face
  const getPosition = (index: number, radius: number) => {
    const angle = (index * 30 - 90) * (Math.PI / 180); // 30 degrees per number, start at 12 o'clock
    return {
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
    };
  };

  // Calculate hand angle
  const getHandAngle = () => {
    if (view === "hours") {
      return ((value % 12) / 12) * 360 - 90;
    }
    return (value / 60) * 360 - 90;
  };

  const handAngle = getHandAngle();
  const handLength = view === "hours" && is24Hour && value >= 12 && value !== 12 ? innerRadius - 8 : outerRadius - 20;
  const handEnd = {
    x: center + Math.cos(handAngle * (Math.PI / 180)) * handLength,
    y: center + Math.sin(handAngle * (Math.PI / 180)) * handLength,
  };

  // Handle click on clock face
  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - center;
    const y = e.clientY - rect.top - center;

    let angle = Math.atan2(y, x) * (180 / Math.PI) + 90;
    if (angle < 0) angle += 360;

    const clickRadius = Math.sqrt(x * x + y * y);

    if (view === "hours") {
      let hour = Math.round(angle / 30) % 12;
      if (hour === 0) hour = 12;

      // For 24-hour mode, check if clicking inner ring
      if (is24Hour && clickRadius < (outerRadius + innerRadius) / 2) {
        hour = hour === 12 ? 0 : hour + 12;
      }

      onChange(hour);
      // Auto-advance to minutes after selecting hour
      setTimeout(() => onViewChange("minutes"), 150);
    } else {
      // Snap to nearest 5 for display, but allow any value
      const minuteOrSecond = Math.round(angle / 6) % 60;
      onChange(minuteOrSecond);

      // Auto-advance from minutes to seconds
      if (view === "minutes") {
        setTimeout(() => onViewChange("seconds"), 150);
      }
    }
  };

  // Check if a number is selected
  const isSelected = (num: number) => {
    if (view === "hours") {
      return value === num || (is24Hour && value === num);
    }
    return value === num;
  };

  return (
    <svg
      width={size}
      height={size}
      className="cursor-pointer"
      onClick={handleClick}
    >
      {/* Clock face background */}
      <circle
        cx={center}
        cy={center}
        r={outerRadius + 8}
        className="fill-slate-800/50"
      />

      {/* Clock hand */}
      <line
        x1={center}
        y1={center}
        x2={handEnd.x}
        y2={handEnd.y}
        className="stroke-violet-500"
        strokeWidth={2}
      />
      <circle cx={handEnd.x} cy={handEnd.y} r={4} className="fill-violet-500" />
      <circle cx={center} cy={center} r={3} className="fill-violet-500" />

      {/* Outer ring numbers */}
      {numbers.outer.map((num, i) => {
        const pos = getPosition(i, outerRadius);
        const selected = isSelected(num);
        return (
          <g key={`outer-${num}`}>
            {selected && (
              <circle cx={pos.x} cy={pos.y} r={14} className="fill-violet-600" />
            )}
            <text
              x={pos.x}
              y={pos.y}
              textAnchor="middle"
              dominantBaseline="central"
              className={cn(
                "text-[10px] font-medium pointer-events-none",
                selected ? "fill-white" : "fill-slate-300"
              )}
            >
              {view === "hours" ? num : num.toString().padStart(2, "0")}
            </text>
          </g>
        );
      })}

      {/* Inner ring for 24-hour mode */}
      {numbers.inner?.map((num, i) => {
        const pos = getPosition(i, innerRadius);
        const selected = isSelected(num);
        return (
          <g key={`inner-${num}`}>
            {selected && (
              <circle cx={pos.x} cy={pos.y} r={12} className="fill-violet-600" />
            )}
            <text
              x={pos.x}
              y={pos.y}
              textAnchor="middle"
              dominantBaseline="central"
              className={cn(
                "text-[9px] font-medium pointer-events-none",
                selected ? "fill-white" : "fill-slate-400"
              )}
            >
              {num.toString().padStart(2, "0")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

interface DateTimePickerProps {
  date: Date | undefined;
  onDateChange: (date: Date | undefined) => void;
  minDate?: Date;
  className?: string;
  placeholder?: string;
}

export function DateTimePicker({
  date,
  onDateChange,
  minDate,
  className,
  placeholder = "Pick date and time",
}: DateTimePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [clockView, setClockView] = React.useState<ClockView>("hours");
  const [timeInput, setTimeInput] = React.useState("");

  // Sync time input with date
  React.useEffect(() => {
    if (date) {
      const hours = date.getHours();
      const minutes = date.getMinutes();
      const seconds = date.getSeconds();
      const ampm = hours >= 12 ? "PM" : "AM";
      const displayHours = hours % 12 || 12;
      setTimeInput(
        `${displayHours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")} ${ampm}`
      );
    } else {
      setTimeInput("");
    }
  }, [date]);

  // Reset clock view when opening
  React.useEffect(() => {
    if (isOpen) {
      setClockView("hours");
    }
  }, [isOpen]);

  const handleDateSelect = (selectedDate: Date | undefined) => {
    if (!selectedDate) {
      onDateChange(undefined);
      return;
    }

    // Preserve existing time or use current time
    const currentHour = date?.getHours() ?? new Date().getHours();
    const currentMinute = date?.getMinutes() ?? 0;
    const currentSecond = date?.getSeconds() ?? 0;

    const newDate = new Date(selectedDate);
    newDate.setHours(currentHour);
    newDate.setMinutes(currentMinute);
    newDate.setSeconds(currentSecond);
    newDate.setMilliseconds(0);

    onDateChange(newDate);
  };

  // Parse and apply time input
  const parseTimeInput = (input: string) => {
    const timeRegex = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i;
    const match = input.trim().match(timeRegex);
    if (!match) return;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = match[3] ? parseInt(match[3], 10) : 0;
    const ampm = match[4]?.toUpperCase();

    if (minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return;

    if (ampm) {
      if (hours < 1 || hours > 12) return;
      if (ampm === "PM" && hours !== 12) hours += 12;
      if (ampm === "AM" && hours === 12) hours = 0;
    } else {
      if (hours < 0 || hours > 23) return;
    }

    const baseDate = date || new Date();
    const newDate = new Date(baseDate);
    newDate.setHours(hours);
    newDate.setMinutes(minutes);
    newDate.setSeconds(seconds);
    newDate.setMilliseconds(0);
    onDateChange(newDate);
  };

  const currentHours = date?.getHours() ?? 0;
  const currentMinutes = date?.getMinutes() ?? 0;
  const currentSeconds = date?.getSeconds() ?? 0;
  const isAM = currentHours < 12;

  // Get current value for clock based on view
  const getClockValue = () => {
    if (clockView === "hours") return currentHours;
    if (clockView === "minutes") return currentMinutes;
    return currentSeconds;
  };

  // Handle clock value change
  const handleClockChange = (value: number) => {
    const baseDate = date || new Date();
    const newDate = new Date(baseDate);

    if (clockView === "hours") {
      // Preserve AM/PM when changing hour
      if (isAM) {
        newDate.setHours(value === 12 ? 0 : value);
      } else {
        newDate.setHours(value === 12 ? 12 : value + 12);
      }
    } else if (clockView === "minutes") {
      newDate.setMinutes(value);
    } else {
      newDate.setSeconds(value);
    }

    newDate.setMilliseconds(0);
    onDateChange(newDate);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal h-8 text-xs",
            "bg-slate-800/50 border-white/10 hover:bg-slate-800 hover:border-white/20",
            !date && "text-slate-500",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-3.5 w-3.5 text-violet-400" />
          {date ? (
            format(date, "MMM d, yyyy 'at' h:mm:ss a")
          ) : (
            <span>{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          {/* Calendar - Left side */}
          <div className="p-2 border-r border-white/10">
            <Calendar
              mode="single"
              selected={date}
              onSelect={handleDateSelect}
              disabled={(d) => minDate ? d < new Date(minDate.setHours(0, 0, 0, 0)) : false}
              initialFocus
              className="rounded-md"
              classNames={{
                months: "flex flex-col",
                month: "space-y-0.5",
                caption: "flex justify-center pt-0.5 relative items-center h-6",
                caption_label: "text-[10px] font-medium text-white",
                nav: "space-x-1 flex items-center",
                nav_button: cn(
                  "h-4 w-4 bg-transparent p-0 text-slate-400 hover:text-white hover:bg-white/10 rounded transition-colors"
                ),
                nav_button_previous: "absolute left-0",
                nav_button_next: "absolute right-0",
                table: "w-full border-collapse",
                head_row: "flex gap-0.5",
                head_cell: "text-slate-500 w-5 font-normal text-[8px] text-center",
                row: "flex w-full gap-0.5",
                cell: cn(
                  "relative p-0 text-center text-[9px] focus-within:relative focus-within:z-20"
                ),
                day: cn(
                  "h-5 w-5 p-0 font-normal text-[9px] rounded transition-colors",
                  "text-slate-300 hover:bg-violet-500/20 hover:text-white",
                  "focus:bg-violet-500/20 focus:text-white focus:outline-none"
                ),
                day_selected: "bg-violet-600 text-white hover:bg-violet-700 hover:text-white focus:bg-violet-700",
                day_today: "bg-slate-700 text-white",
                day_outside: "text-slate-600 opacity-50",
                day_disabled: "text-slate-600 opacity-50 cursor-not-allowed",
                day_hidden: "invisible",
              }}
            />
          </div>

          {/* Time Picker - Right side */}
          <div className="p-2 flex flex-col">
            {/* Time input */}
            <Input
              value={timeInput}
              onChange={(e) => setTimeInput(e.target.value)}
              onBlur={() => parseTimeInput(timeInput)}
              onKeyDown={(e) => e.key === "Enter" && parseTimeInput(timeInput)}
              placeholder="12:00:00 PM"
              className="h-7 text-xs font-mono bg-slate-800/50 border-white/10 text-center mb-2"
            />

            {/* View tabs */}
            <div className="flex gap-1 mb-2">
              {(["hours", "minutes", "seconds"] as const).map((view) => (
                <button
                  key={view}
                  onClick={() => setClockView(view)}
                  className={cn(
                    "flex-1 h-6 text-[9px] rounded transition-colors",
                    clockView === view
                      ? "bg-violet-600 text-white"
                      : "bg-slate-800/50 text-slate-400 hover:bg-violet-500/20"
                  )}
                >
                  {view === "hours" ? "HR" : view === "minutes" ? "MIN" : "SEC"}
                </button>
              ))}
            </div>

            {/* Clock face */}
            <div className="flex justify-center">
              <ClockFace
                value={getClockValue()}
                view={clockView}
                onChange={handleClockChange}
                onViewChange={setClockView}
              />
            </div>

            {/* AM/PM toggle */}
            <div className="flex gap-1 mt-2">
              <button
                onClick={() => {
                  if (!date) return;
                  const newDate = new Date(date);
                  const hours = newDate.getHours();
                  if (hours >= 12) newDate.setHours(hours - 12);
                  onDateChange(newDate);
                }}
                className={cn(
                  "flex-1 h-6 text-[10px] rounded transition-colors",
                  isAM
                    ? "bg-violet-600 text-white"
                    : "bg-slate-800/50 text-slate-400 hover:bg-violet-500/20"
                )}
              >
                AM
              </button>
              <button
                onClick={() => {
                  if (!date) return;
                  const newDate = new Date(date);
                  const hours = newDate.getHours();
                  if (hours < 12) newDate.setHours(hours + 12);
                  onDateChange(newDate);
                }}
                className={cn(
                  "flex-1 h-6 text-[10px] rounded transition-colors",
                  !isAM
                    ? "bg-violet-600 text-white"
                    : "bg-slate-800/50 text-slate-400 hover:bg-violet-500/20"
                )}
              >
                PM
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Separate components for just date or just time if needed
export function DatePicker({
  date,
  onDateChange,
  minDate,
  className,
  placeholder = "Pick a date",
}: Omit<DateTimePickerProps, "placeholder"> & { placeholder?: string }) {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal h-8 text-xs",
            "bg-slate-800/50 border-white/10 hover:bg-slate-800 hover:border-white/20",
            !date && "text-slate-500",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-3.5 w-3.5 text-violet-400" />
          {date ? format(date, "PPP") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={onDateChange}
          disabled={(d) => minDate ? d < new Date(minDate.setHours(0, 0, 0, 0)) : false}
          initialFocus
          classNames={{
            months: "flex flex-col",
            month: "space-y-2",
            caption: "flex justify-center pt-0.5 relative items-center",
            caption_label: "text-xs font-medium text-white",
            nav: "space-x-1 flex items-center",
            nav_button: cn(
              "h-6 w-6 bg-transparent p-0 text-slate-400 hover:text-white hover:bg-white/10 rounded-md transition-colors"
            ),
            nav_button_previous: "absolute left-0.5",
            nav_button_next: "absolute right-0.5",
            table: "w-full border-collapse space-y-0.5",
            head_row: "flex",
            head_cell: "text-slate-500 rounded-md w-7 font-normal text-[10px]",
            row: "flex w-full mt-0.5",
            cell: cn(
              "relative p-0 text-center text-xs focus-within:relative focus-within:z-20",
              "first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md"
            ),
            day: cn(
              "h-7 w-7 p-0 font-normal text-xs rounded-md transition-colors",
              "text-slate-300 hover:bg-violet-500/20 hover:text-white",
              "focus:bg-violet-500/20 focus:text-white focus:outline-none"
            ),
            day_selected: "bg-violet-600 text-white hover:bg-violet-700 hover:text-white focus:bg-violet-700",
            day_today: "bg-slate-700 text-white",
            day_outside: "text-slate-600 opacity-50",
            day_disabled: "text-slate-600 opacity-50 cursor-not-allowed",
            day_hidden: "invisible",
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

interface TimePickerProps {
  time: { hour: number; minute: number; second?: number } | undefined;
  onTimeChange: (time: { hour: number; minute: number; second: number }) => void;
  className?: string;
}

export function TimePicker({
  time,
  onTimeChange,
  className,
}: TimePickerProps) {
  const [timeInput, setTimeInput] = React.useState("");

  React.useEffect(() => {
    if (time) {
      const hours = time.hour;
      const minutes = time.minute;
      const seconds = time.second ?? 0;
      const ampm = hours >= 12 ? "PM" : "AM";
      const displayHours = hours % 12 || 12;
      setTimeInput(
        `${displayHours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")} ${ampm}`
      );
    }
  }, [time]);

  const parseAndUpdateTime = (input: string) => {
    const timeRegex = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i;
    const match = input.trim().match(timeRegex);

    if (!match) return;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = match[3] ? parseInt(match[3], 10) : 0;
    const ampm = match[4]?.toUpperCase();

    if (minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return;

    if (ampm) {
      if (hours < 1 || hours > 12) return;
      if (ampm === "PM" && hours !== 12) hours += 12;
      if (ampm === "AM" && hours === 12) hours = 0;
    } else {
      if (hours < 0 || hours > 23) return;
    }

    onTimeChange({ hour: hours, minute: minutes, second: seconds });
  };

  const isAM = (time?.hour ?? 0) < 12;

  const toggleAmPm = () => {
    if (!time) return;
    const hours = time.hour;
    onTimeChange({
      hour: hours >= 12 ? hours - 12 : hours + 12,
      minute: time.minute,
      second: time.second ?? 0,
    });
  };

  const adjustTime = (field: "hour" | "minute" | "second", delta: number) => {
    const current = time ?? { hour: 0, minute: 0, second: 0 };
    let { hour, minute, second } = current;
    second = second ?? 0;

    if (field === "hour") {
      hour = (hour + delta + 24) % 24;
    } else if (field === "minute") {
      minute = (minute + delta + 60) % 60;
    } else {
      second = (second + delta + 60) % 60;
    }

    onTimeChange({ hour, minute, second });
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-1 text-[10px] text-slate-400">
        <Clock className="h-3 w-3 text-violet-400" />
        <span>Time</span>
      </div>

      <Input
        value={timeInput}
        onChange={(e) => setTimeInput(e.target.value)}
        onBlur={() => parseAndUpdateTime(timeInput)}
        onKeyDown={(e) => e.key === "Enter" && parseAndUpdateTime(timeInput)}
        placeholder="12:00:00 PM"
        className="h-7 text-xs font-mono bg-slate-800/50 border-white/10 text-center"
      />

      <div className="grid grid-cols-3 gap-1">
        {(["hour", "minute", "second"] as const).map((field) => (
          <div key={field} className="flex flex-col items-center gap-0.5">
            <button
              onClick={() => adjustTime(field, 1)}
              className="w-full h-5 text-[10px] text-slate-400 hover:text-white hover:bg-white/10 rounded transition-colors"
            >
              ▲
            </button>
            <span className="text-[10px] text-slate-500">
              {field === "hour" ? "hr" : field === "minute" ? "min" : "sec"}
            </span>
            <button
              onClick={() => adjustTime(field, -1)}
              className="w-full h-5 text-[10px] text-slate-400 hover:text-white hover:bg-white/10 rounded transition-colors"
            >
              ▼
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-1">
        <button
          onClick={toggleAmPm}
          className={cn(
            "flex-1 h-6 text-[10px] rounded transition-colors",
            isAM
              ? "bg-violet-600 text-white"
              : "bg-slate-800/50 text-slate-400 hover:text-white hover:bg-white/10"
          )}
        >
          AM
        </button>
        <button
          onClick={toggleAmPm}
          className={cn(
            "flex-1 h-6 text-[10px] rounded transition-colors",
            !isAM
              ? "bg-violet-600 text-white"
              : "bg-slate-800/50 text-slate-400 hover:text-white hover:bg-white/10"
          )}
        >
          PM
        </button>
      </div>
    </div>
  );
}
